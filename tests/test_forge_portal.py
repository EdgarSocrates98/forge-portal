"""pytest suite for the vendored forge_portal.py server.

Spins the real server on an ephemeral port and exercises the full
security matrix from docs/fase0/security-matrix.md with urllib —
no test-only shortcuts; the same code path the browser uses.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "portal_core"))

import forge_portal as fp


class DemoAdapter(fp.PortalAdapter):
    forge_id = "the-forge"
    forge_name = "The Forge"
    cli = "theforge"

    def __init__(self, assets: Path | None = None) -> None:
        self.assets_dir = assets
        self.install_count = 0
        self.ops = fp.default_operations(self) + [
            fp.Operation("GET", "/skills", lambda ctx: [{"id": "demo", "api_key": "sekret"}]),
            fp.Operation(
                "POST",
                "/installation/plan",
                self._plan,
                mutating=True,
            ),
            fp.Operation(
                "POST",
                "/installation/apply",
                self._apply,
                mutating=True,
                confirm="apply",
                needs_plan_token=True,
            ),
            fp.Operation("GET", "/slow", lambda ctx: time.sleep(5), timeout=0.2),
            fp.Operation(
                "POST",
                "/stream",
                lambda ctx: fp.SseResult(
                    [{"event": "stage", "stage": "running"}, {"event": "done", "status": "ok"}]
                ),
            ),
        ]

    def _plan(self, ctx):
        plan = {"scope": (ctx.body or {}).get("scope", "project"), "actions": [{"kind": "write", "path": ".mcp.json"}]}
        return {"status": "planned", "plan": plan, "plan_token": ctx.handler.server.sign_plan(plan)}

    def _apply(self, ctx):
        self.install_count += 1
        plan = {"scope": "project", "actions": [{"kind": "write", "path": ".mcp.json"}]}
        if not ctx.handler.server.check_plan(ctx.body["plan_token"], plan):
            raise fp.PortalError("PORTAL-PLAN-STALE", "plan token invalid or expired", http=409)
        return {"status": "applied", "actions": [{"kind": "write", "path": ".mcp.json", "status": "ok"}]}


@pytest.fixture(scope="session")
def assets(tmp_path_factory) -> Path:
    tmp_path = tmp_path_factory.mktemp("assets")
    (tmp_path / "index.html").write_text("<html>portal</html>", encoding="utf-8")
    (tmp_path / "app.js").write_text("console.log(1)", encoding="utf-8")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "x.txt").write_text("x", encoding="utf-8")
    return tmp_path


@pytest.fixture(scope="session")
def server(assets: Path):
    # One server for the whole module: per-test servers on fresh ephemeral
    # ports race Windows' TCP teardown — a stale RST from a closed socket
    # can abort the first request to a newly-bound port. A shared server
    # exercises the real keep-alive path anyway; per-test state is reset
    # below instead.
    srv = fp.PortalServer(DemoAdapter(assets), quiet=True)
    thread = srv.serve_in_thread()
    yield srv
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=5)


@pytest.fixture(autouse=True)
def _reset_state(server):
    yield
    server.adapter.install_count = 0
    server.rate_limiter._hits.clear()


def call(server: fp.PortalServer, method: str, path: str, *, body=None, session=True, headers=None, raw_body=None):
    url = f"http://127.0.0.1:{server.port}{path}"
    data = raw_body
    hdrs = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
    if session:
        hdrs[fp.SESSION_HEADER] = server.session_token
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            ctype = resp.headers.get("Content-Type", "")
            payload = resp.read()
            if "json" in ctype:
                return resp.status, json.loads(payload), dict(resp.headers)
            return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, payload, dict(e.headers)


# ---------------------------------------------------------------------------
# envelope + session


class TestEnvelopeAndSession:
    def test_bootstrap_envelope(self, server):
        status, env, _ = call(server, "GET", "/api/v1/bootstrap")
        assert status == 200
        assert env["schema"] == "forge/PortalApi/1"
        assert "correlation_id" in env
        assert env["data"]["descriptor"]["forge_id"] == "the-forge"

    def test_correlation_echo(self, server):
        _, env, _ = call(server, "GET", "/api/v1/health", headers={"X-Correlation-Id": "abc123"})
        assert env["correlation_id"] == "abc123"

    def test_no_session_is_403(self, server):
        status, env, _ = call(server, "GET", "/api/v1/health", session=False)
        assert status == 403
        assert env["error"]["code"] == "PORTAL-SESSION"
        assert env["error"]["message_key"] == "error.session"

    def test_wrong_session_is_403(self, server):
        status, _, _ = call(server, "GET", "/api/v1/health", headers={fp.SESSION_HEADER: "wrong"})
        assert status == 403

    def test_unknown_op_404_named(self, server):
        status, env, _ = call(server, "GET", "/api/v1/definitely-not-an-op")
        assert status == 404
        assert env["error"]["code"] == "PORTAL-NOT-FOUND"

    def test_get_never_mutates(self, server):
        call(server, "GET", "/api/v1/installation/status")
        assert server.adapter.install_count == 0

    def test_account_environment_reports_ready_paths(self, server, tmp_path, monkeypatch):
        install = tmp_path / "install"
        venv = install / ".venv"
        checkout = tmp_path / "checkout"
        install.mkdir()
        venv.mkdir()
        checkout.mkdir()
        python = venv / "python.exe"
        cli = venv / "theforge.exe"
        python.write_text("", encoding="utf-8")
        cli.write_text("", encoding="utf-8")
        values = {
            "THE_FORGE_HOME": str(checkout),
            "THE_FORGE_INSTALL_ROOT": str(install),
            "THE_FORGE_VENV": str(venv),
            "THE_FORGE_PYTHON": str(python),
            "THE_FORGE_CLI": str(cli),
        }
        for name, value in values.items():
            monkeypatch.setenv(name, value)

        status, env, _ = call(server, "GET", "/api/v1/environment")

        assert status == 200
        assert env["data"]["schema"] == "forge/InstallEnvironment/v1"
        assert env["data"]["state"] == "READY"
        assert all(item["valid"] for item in env["data"]["variables"] if item["required"])

    def test_account_environment_missing_is_honest(self, server, monkeypatch):
        for suffix in ("HOME", "INSTALL_ROOT", "VENV", "PYTHON", "CLI", "LAUNCHER"):
            monkeypatch.delenv(f"THE_FORGE_{suffix}", raising=False)

        status, env, _ = call(server, "GET", "/api/v1/environment")

        assert status == 200
        assert env["data"]["state"] == "MISSING"


# ---------------------------------------------------------------------------
# CSRF / payload guards


class TestCsrfAndPayload:
    def _plan_body(self):
        return {"scope": "project"}

    def test_post_cross_origin_403(self, server):
        status, env, _ = call(
            server, "POST", "/api/v1/installation/plan",
            body=self._plan_body(), headers={"Origin": "https://evil.example"},
        )
        assert status == 403
        assert env["error"]["code"] == "PORTAL-ORIGIN"

    def test_post_loopback_origin_ok(self, server):
        status, _, _ = call(
            server, "POST", "/api/v1/installation/plan",
            body=self._plan_body(), headers={"Origin": "http://localhost:4200"},
        )
        assert status == 200

    def test_get_foreign_host_403(self, server):
        # DNS rebinding: browser at attacker.example → 127.0.0.1 sends
        # Host: attacker.example — refuse before routing (API or assets).
        status, env, _ = call(
            server, "GET", "/api/v1/health",
            headers={"Host": "attacker.example"},
        )
        assert status == 403
        assert env["error"]["code"] == "PORTAL-HOST"

    def test_post_foreign_host_403(self, server):
        status, env, _ = call(
            server, "POST", "/api/v1/installation/plan",
            body=self._plan_body(), headers={"Host": "attacker.example:80"},
        )
        assert status == 403
        assert env["error"]["code"] == "PORTAL-HOST"

    def test_static_foreign_host_403(self, server):
        status, env, _ = call(server, "GET", "/", headers={"Host": "evil.test"})
        assert status == 403
        assert env["error"]["code"] == "PORTAL-HOST"

    def test_loopback_host_ok(self, server):
        status, _, _ = call(
            server, "GET", "/api/v1/health",
            headers={"Host": "localhost:9999"},
        )
        assert status == 200

    def test_post_wrong_content_type_415(self, server):
        status, env, _ = call(
            server, "POST", "/api/v1/installation/plan",
            body=self._plan_body(), headers={"Content-Type": "text/plain"},
        )
        assert status == 415
        assert env["error"]["code"] == "PORTAL-CONTENT-TYPE"

    def test_payload_too_large_413(self, server):
        big = json.dumps({"pad": "x" * (1 << 20)}).encode()
        status, env, _ = call(server, "POST", "/api/v1/installation/plan", raw_body=big)
        assert status == 413
        assert env["error"]["code"] == "PORTAL-PAYLOAD-TOO-LARGE"

    def test_bad_json_400(self, server):
        status, env, _ = call(server, "POST", "/api/v1/installation/plan", raw_body=b"{not json")
        assert status == 400
        assert env["error"]["code"] == "PORTAL-BAD-JSON"


# ---------------------------------------------------------------------------
# confirm + plan token


class TestConfirmAndPlanToken:
    def test_apply_without_confirm_400(self, server):
        status, env, _ = call(server, "POST", "/api/v1/installation/apply", body={"plan_token": "x"})
        assert status == 400
        assert env["error"]["code"] == "PORTAL-CONFIRM"

    def test_apply_without_plan_token_400(self, server):
        status, env, _ = call(server, "POST", "/api/v1/installation/apply", body={"confirm": "apply"})
        assert status == 400
        assert env["error"]["code"] == "PORTAL-PLAN-REQUIRED"

    def test_apply_with_fake_token_409(self, server):
        status, env, _ = call(
            server, "POST", "/api/v1/installation/apply",
            body={"confirm": "apply", "plan_token": "fake.token"},
        )
        assert status == 409
        assert env["error"]["code"] == "PORTAL-PLAN-STALE"

    def test_plan_apply_roundtrip(self, server):
        s1, env1, _ = call(server, "POST", "/api/v1/installation/plan", body={"scope": "project"})
        assert s1 == 200
        token = env1["data"]["plan_token"]
        s2, env2, _ = call(
            server, "POST", "/api/v1/installation/apply",
            body={"confirm": "apply", "plan_token": token},
        )
        assert s2 == 200
        assert env2["data"]["status"] == "applied"
        assert server.adapter.install_count == 1


# ---------------------------------------------------------------------------
# rate limit + timeout


class TestRateAndTimeout:
    def test_mutation_rate_limit(self, server):
        for _ in range(10):
            s, _, _ = call(server, "POST", "/api/v1/installation/plan", body={"scope": "project"})
            assert s == 200
        s, env, _ = call(server, "POST", "/api/v1/installation/plan", body={"scope": "project"})
        assert s == 429
        assert env["error"]["code"] == "PORTAL-RATE-LIMITED"
        assert env["error"]["retryable"] is True

    def test_gets_not_rate_limited(self, server):
        for _ in range(15):
            s, _, _ = call(server, "GET", "/api/v1/health")
            assert s == 200

    def test_timeout_504(self, server):
        s, env, _ = call(server, "GET", "/api/v1/slow")
        assert s == 504
        assert env["error"]["code"] == "PORTAL-TIMEOUT"


# ---------------------------------------------------------------------------
# SSE


class TestSse:
    def test_sse_stream(self, server):
        req = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/api/v1/stream",
            data=b"{}", method="POST",
            headers={"Content-Type": "application/json", fp.SESSION_HEADER: server.session_token},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            assert resp.headers["Content-Type"].startswith("text/event-stream")
            body = resp.read().decode()
        events = [json.loads(line[5:]) for line in body.splitlines() if line.startswith("data: ")]
        assert events == [
            {"event": "stage", "stage": "running"},
            {"event": "done", "status": "ok"},
        ]


# ---------------------------------------------------------------------------
# static serving


class TestStatic:
    def test_index_served(self, server):
        s, body, hdrs = call(server, "GET", "/", session=False)
        assert s == 200
        assert b"portal" in body
        assert hdrs["X-Content-Type-Options"] == "nosniff"
        assert "Content-Security-Policy" in hdrs

    def test_traversal_404(self, server):
        for path in ("/../secret.txt", "/..%2fsecret.txt", "/sub/../../etc/passwd"):
            s, _, _ = call(server, "GET", path, session=False)
            assert s == 404, path

    def test_spa_fallback(self, server):
        s, body, _ = call(server, "GET", "/dashboard", session=False)
        assert s == 200
        assert b"portal" in body

    def test_session_cookie_on_document(self, server):
        s, _, hdrs = call(
            server, "GET", f"/?forge_session={server.session_token}", session=False,
        )
        assert s == 200
        cookie = hdrs.get("Set-Cookie", "")
        assert "forge_session=" in cookie
        assert "SameSite=Strict" in cookie
        assert "HttpOnly" in cookie


# ---------------------------------------------------------------------------
# redaction + headers


class TestHygiene:
    def test_secret_fields_redacted(self, server):
        s, env, _ = call(server, "GET", "/api/v1/skills")
        assert s == 200
        assert env["data"][0]["api_key"] == "«redacted»"

    def test_security_headers_on_api(self, server):
        _, _, hdrs = call(server, "GET", "/api/v1/health")
        assert hdrs["X-Content-Type-Options"] == "nosniff"
        assert hdrs["Referrer-Policy"] == "no-referrer"
        assert "default-src 'self'" in hdrs["Content-Security-Policy"]

    def test_bind_loopback_only(self):
        with pytest.raises(ValueError):
            fp.PortalServer(fp.PortalAdapter(), host="0.0.0.0")


# ---------------------------------------------------------------------------
# plan token unit checks


class TestPlanToken:
    def test_roundtrip(self):
        secret = b"x" * 32
        plan = {"a": 1, "b": ["z"]}
        tok = fp.make_plan_token(secret, plan)
        assert fp.check_plan_token(secret, tok, plan)

    def test_tampered_plan_fails(self):
        secret = b"x" * 32
        tok = fp.make_plan_token(secret, {"a": 1})
        assert not fp.check_plan_token(secret, tok, {"a": 2})

    def test_garbage_fails(self):
        assert not fp.check_plan_token(b"x" * 32, "garbage", {"a": 1})
        assert not fp.check_plan_token(b"x" * 32, "", {"a": 1})


# ---------------------------------------------------------------------------
# forge-portal presence
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_forge_home(tmp_path, monkeypatch):
    home = tmp_path / "forgehome"
    home.mkdir()
    monkeypatch.setenv("FORGE_HOME_OVERRIDE", str(home))
    monkeypatch.delenv("FORGE_PORTAL_HOME", raising=False)
    return home


class TestForgePortalPresence:
    def test_vendored_when_absent(self, isolated_forge_home):
        p = fp.detect_forge_portal()
        assert p["state"] == "vendored"
        assert p["install_root"] is None
        assert p["locations"] == []

    def test_env_root(self, isolated_forge_home, tmp_path, monkeypatch):
        root = tmp_path / "portal-root"
        root.mkdir()
        monkeypatch.setenv("FORGE_PORTAL_HOME", str(root))
        p = fp.detect_forge_portal()
        assert p["state"] == "installed"
        assert p["install_root"] == str(root)

    def test_registry_manifest(self, isolated_forge_home):
        installs = isolated_forge_home / ".forge" / "installs" / "forge-portal"
        installs.mkdir(parents=True)
        manifests = isolated_forge_home / ".forge" / "installations"
        manifests.mkdir(parents=True)
        (manifests / "forge-portal.json").write_text(
            json.dumps({"forge_id": "forge-portal", "install_root": str(installs)}),
            encoding="utf-8",
        )
        p = fp.detect_forge_portal()
        assert p["state"] == "installed"
        assert p["install_root"] == str(installs)

    def test_stale_install_root_is_honest(self, isolated_forge_home):
        manifests = isolated_forge_home / ".forge" / "installations"
        manifests.mkdir(parents=True)
        (manifests / "forge-portal.json").write_text(
            json.dumps(
                {"forge_id": "forge-portal", "install_root": str(isolated_forge_home / "gone")}
            ),
            encoding="utf-8",
        )
        p = fp.detect_forge_portal()
        assert p["state"] == "installed"
        assert p["install_root"] is None

    def test_default_install_root(self, isolated_forge_home):
        root = isolated_forge_home / ".forge" / "installs" / "forge-portal"
        root.mkdir(parents=True)
        p = fp.detect_forge_portal()
        assert p["state"] == "installed"
        assert p["install_root"] == str(root)

    def test_health_endpoint_carries_presence(self, server, isolated_forge_home):
        status, env, _ = call(server, "GET", "/api/v1/health")
        assert status == 200
        assert env["data"]["forge_portal"]["state"] == "vendored"

    def test_installation_status_carries_presence(self, server, isolated_forge_home):
        status, env, _ = call(server, "GET", "/api/v1/installation/status")
        assert status == 200
        assert env["data"]["forge_portal"]["state"] == "vendored"

    def test_bootstrap_health_carries_presence(self, server, isolated_forge_home):
        status, env, _ = call(server, "GET", "/api/v1/bootstrap")
        assert status == 200
        assert env["data"]["health"]["forge_portal"]["state"] == "vendored"
