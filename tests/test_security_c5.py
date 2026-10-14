"""§5.7 operational security battery — vendored ``portal_core/forge_portal.py``.

One test per §5.7 checklist item, executed against the real HTTP server
(stdlib only: urllib + threads, same fixture pattern as test_forge_portal.py).
Where a control exists the test asserts it (regression guard); where it is
absent the test pins the observed behavior and
``docs/roadmap/C5_SECURITY_MATRIX.md`` marks the item UNVERIFIED with cause —
nothing here is weakened to force green.
"""

from __future__ import annotations

import concurrent.futures
import dataclasses
import hashlib
import hmac
import inspect
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "portal_core"))

import forge_portal as fp

SECRET_MARK = "PORTAL-SECRET-7f3a9c-do-not-serve"
PLAN_PROJECT = {"scope": "project", "actions": [{"kind": "write", "path": ".mcp.json"}]}

# Response payload exercising every redaction trigger + the documented
# boundary (a secret-SHAPED value under a benign key).
_SECRET_PAYLOAD = {
    "api_key": "AKIA-DEMO-SECRET",
    "nested": {
        "authorization": "Bearer demo-token",
        "credential": "cred",
        "inner": {"apikey": "k2", "session_token": "t3"},
    },
    "items": [{"password": "hunter2"}, {"safe": "shown"}],
    "plan_token": "client-usable-plan-token",
    "note": "AKIA-SHAPED-VALUE-UNDER-BENIGN-KEY",
}


class SecAdapter(fp.PortalAdapter):
    """Minimal adapter surface needed to probe each §5.7 control.

    `_apply` checks the plan token BEFORE mutating (unlike the C3 demo
    adapter) so rejected applies can be asserted to leave state untouched.
    """

    forge_id = "the-forge"
    forge_name = "The Forge"
    cli = "theforge"

    def __init__(self, assets: Path | None = None) -> None:
        self.assets_dir = assets
        self.apply_count = 0
        self.counter = 0
        self._counter_lock = threading.Lock()
        self.ops = fp.default_operations(self) + [
            fp.Operation("GET", "/secrets", lambda ctx: _SECRET_PAYLOAD),
            # non-mutating POST: body reaches the handler as a plain dict —
            # probe surface for RCE/SSRF payloads without burning rate budget
            fp.Operation("POST", "/echo", lambda ctx: {"received": ctx.body}),
            fp.Operation("POST", "/crash", self._crash),
            fp.Operation("POST", "/counter", self._count, mutating=True),
            fp.Operation("POST", "/installation/plan", self._plan, mutating=True),
            fp.Operation(
                "POST",
                "/installation/apply",
                self._apply,
                mutating=True,
                confirm="apply",
                needs_plan_token=True,
            ),
        ]

    def _crash(self, ctx):
        raise ValueError("boom")

    def _count(self, ctx):
        with self._counter_lock:
            self.counter += 1
            return {"count": self.counter}

    def _plan(self, ctx):
        plan = dict(PLAN_PROJECT, scope=(ctx.body or {}).get("scope", "project"))
        return {"status": "planned", "plan": plan, "plan_token": ctx.handler.server.sign_plan(plan)}

    def _apply(self, ctx):
        if not ctx.handler.server.check_plan(ctx.body["plan_token"], PLAN_PROJECT):
            raise fp.PortalError("PORTAL-PLAN-STALE", "plan token invalid or expired", http=409)
        self.apply_count += 1
        return {"status": "applied", "actions": [dict(a, status="ok") for a in PLAN_PROJECT["actions"]]}


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
    # Shared module-scoped server — see test_forge_portal.py for why
    # (Windows TCP teardown races fresh ephemeral binds).
    srv = fp.PortalServer(SecAdapter(assets), quiet=True)
    thread = srv.serve_in_thread()
    yield srv
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=5)


@pytest.fixture(autouse=True)
def _reset_state(server):
    # Rate window is 60 s — clear before AND after so a hot test cannot
    # bleed budget into the next one.
    server.rate_limiter._hits.clear()
    server.adapter.apply_count = 0
    server.adapter.counter = 0
    yield
    server.rate_limiter._hits.clear()


# Never honor ambient proxy env vars: a configured proxy would turn the
# client's loopback call into a non-loopback connect and poison §5.7.9.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


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
        with _OPENER.open(req, timeout=10) as resp:
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


def _plan_token(server, scope: str = "project") -> str:
    s, env, _ = call(server, "POST", "/api/v1/installation/plan", body={"scope": scope})
    assert s == 200
    return env["data"]["plan_token"]


def _apply(server, token: str):
    return call(
        server,
        "POST",
        "/api/v1/installation/apply",
        body={"confirm": "apply", "plan_token": token},
    )


def _crafted_token(server: fp.PortalServer, plan: dict, *, ts: int) -> str:
    """A *validly signed* plan token with an attacker-chosen timestamp —
    proves the TTL check is enforced end-to-end, not just signature checks."""
    raw = json.dumps(plan, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    sig = hmac.new(server._plan_secret, raw, hashlib.sha256).hexdigest()
    payload = f"{ts}:{hashlib.sha256(raw).hexdigest()[:16]}:{sig}"
    return "craftednonce." + urllib.parse.quote(payload, safe="")


def _make_link(link: Path, target: Path, *, is_dir: bool) -> str | None:
    """Best-effort link creation; returns the mechanism used or None."""
    try:
        os.symlink(target, link, target_is_directory=is_dir)
        return "symlink"
    except OSError:
        pass
    if is_dir and os.name == "nt":
        # Directory junction — reparse point, no admin privilege required.
        r = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
        )
        if r.returncode == 0:
            return "junction"
    return None


# ---------------------------------------------------------------------------
# §5.7.1 — session expiration


class TestSessionToken:
    def test_foreign_session_token_rejected(self, server):
        # No time-based expiry exists (see _session_ok) — a session lives
        # for the process lifetime. The stale/expired analogue is a token
        # from a *different* boot: per-process random, so restart revokes.
        other = fp.PortalServer(fp.PortalAdapter(), port=0)
        try:
            foreign = other.session_token
        finally:
            other.server_close()
        status, env, _ = call(server, "GET", "/api/v1/health", headers={fp.SESSION_HEADER: foreign})
        assert status == 403
        assert env["error"]["code"] == "PORTAL-SESSION"

        status, env, _ = call(server, "GET", "/api/v1/health", headers={fp.SESSION_HEADER: "garbage"})
        assert status == 403
        assert env["error"]["code"] == "PORTAL-SESSION"

    def test_cookie_session_mismatch_rejected(self, server):
        # Valid header + forged cookie → reject (cookie is bound, not ignored).
        status, env, _ = call(
            server,
            "GET",
            "/api/v1/health",
            headers={"Cookie": f"{fp.SESSION_COOKIE}=forged-cookie-value"},
        )
        assert status == 403
        assert env["error"]["code"] == "PORTAL-SESSION"
        # Correct cookie but no header → still reject: header is required.
        status, env, _ = call(
            server,
            "GET",
            "/api/v1/health",
            session=False,
            headers={"Cookie": f"{fp.SESSION_COOKIE}={server.session_token}"},
        )
        assert status == 403

    def test_session_has_no_time_expiry(self, server):
        # Documented design: _session_ok performs only constant-time token
        # comparison — no timestamp, no TTL. Pin that this is the real code.
        src = inspect.getsource(fp.PortalHandler._session_ok)
        assert "time" not in src and "expir" not in src.lower()
        # And the token is stable for the process lifetime.
        for _ in range(3):
            s, _, _ = call(server, "GET", "/api/v1/health")
            assert s == 200


# ---------------------------------------------------------------------------
# §5.7.2 — CSRF: confirm literal + JSON content-type kill browser POSTs


class TestCsrfConfirm:
    def test_mutating_post_without_confirm_rejected(self, server):
        status, env, _ = call(
            server,
            "POST",
            "/api/v1/installation/apply",
            body={"plan_token": "x"},
        )
        assert status == 400
        assert env["error"]["code"] == "PORTAL-CONFIRM"
        # Wrong literal is equally refused.
        status, env, _ = call(
            server,
            "POST",
            "/api/v1/installation/apply",
            body={"confirm": "yes", "plan_token": "x"},
        )
        assert status == 400
        assert env["error"]["code"] == "PORTAL-CONFIRM"
        assert server.adapter.apply_count == 0

    def test_form_style_post_rejected(self, server):
        # A cross-site HTML form can only send "simple" content types —
        # the JSON requirement blocks that CSRF shape outright.
        status, env, _ = call(
            server,
            "POST",
            "/api/v1/installation/plan",
            raw_body=b"scope=project&confirm=apply",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert status == 415
        assert env["error"]["code"] == "PORTAL-CONTENT-TYPE"


# ---------------------------------------------------------------------------
# §5.7.3 — Origin validation


class TestOriginValidation:
    def test_non_loopback_origin_rejected(self, server):
        for origin in (
            "https://evil.example",
            "http://127.0.0.1.evil.example",  # suffix spoof attempt
            "http://localhost.evil.com",
            "null",  # sandboxed iframe origin
        ):
            status, env, _ = call(
                server,
                "POST",
                "/api/v1/echo",
                body={"p": 1},
                headers={"Origin": origin},
            )
            assert status == 403, origin
            assert env["error"]["code"] == "PORTAL-ORIGIN"
        # Sanity: loopback origins pass (the control is an allowlist,
        # not a blanket refusal).
        for origin in ("http://localhost:4200", f"http://127.0.0.1:{server.port}"):
            status, _, _ = call(
                server, "POST", "/api/v1/echo", body={"p": 1}, headers={"Origin": origin}
            )
            assert status == 200, origin


# ---------------------------------------------------------------------------
# §5.7.4 — Host-header validation (DNS-rebinding guard)


class TestHostHeader:
    def test_non_loopback_host_rejected(self, server):
        for host in (
            "attacker.example",
            "localhost.evil.example",
            "127.0.0.1.evil.example",
            "169.254.169.254",
        ):
            status, env, _ = call(server, "GET", "/api/v1/health", headers={"Host": host})
            assert status == 403, host
            assert env["error"]["code"] == "PORTAL-HOST"

    def test_foreign_host_rejected_before_routing(self, server):
        # POST to a real op and GET to a real asset are refused identically —
        # the guard runs before routing, not per-route.
        status, env, _ = call(
            server,
            "POST",
            "/api/v1/installation/plan",
            body={"scope": "project"},
            headers={"Host": "attacker.example:80"},
        )
        assert status == 403
        assert env["error"]["code"] == "PORTAL-HOST"
        status, env, _ = call(server, "GET", "/", session=False, headers={"Host": "evil.test"})
        assert status == 403
        assert env["error"]["code"] == "PORTAL-HOST"


# ---------------------------------------------------------------------------
# §5.7.5 — rate limit


class TestRateLimit:
    def test_mutating_endpoint_429_within_bound(self, server):
        # Bounded hammer: documented limit is 10 mutating ops / 60 s.
        for _ in range(fp.MUTATION_LIMIT):
            s, _, _ = call(server, "POST", "/api/v1/installation/plan", body={})
            assert s == 200
        for _ in range(5):  # stays bounded — never loop unbounded
            s, env, _ = call(server, "POST", "/api/v1/installation/plan", body={})
            assert s == 429
            assert env["error"]["code"] == "PORTAL-RATE-LIMITED"
            assert env["error"]["retryable"] is True
        # Read surface unaffected.
        s, _, _ = call(server, "GET", "/api/v1/health")
        assert s == 200


# ---------------------------------------------------------------------------
# §5.7.6 — path traversal on static assets


class TestPathTraversal:
    def test_traversal_variants_rejected(self, server, assets, tmp_path):
        # Secret planted OUTSIDE the assets root but inside the temp tree.
        outside_secret = assets.parent / f"outside-{secrets.token_hex(4)}.txt"
        outside_secret.write_text(SECRET_MARK, encoding="utf-8")
        name = outside_secret.name
        probes = (
            f"/../{name}",
            f"/..%2f{name}",
            f"/%2e%2e%2f{name}",
            f"/%2e%2e/{name}",
            f"/sub/../../{name}",
            f"/sub/..%2f..%2f{name}",
            f"/..%252f{name}",  # double-encoded — first unquote still yields a .. prefix
            "/..%5c..%5cwindows%5cwin.ini",
        )
        for path in probes:
            s, body, _ = call(server, "GET", path, session=False)
            assert s == 404, path
            if isinstance(body, bytes):
                assert SECRET_MARK.encode() not in body, path
        # Extension-less escapes fall through to the SPA fallback: contained
        # (index.html served), never the outside file.
        s, body, _ = call(server, "GET", "//etc/passwd", session=False)
        assert s in (200, 404)
        assert SECRET_MARK.encode() not in body and b"root:" not in body
        # Sanity: a normal asset still serves (control is containment,
        # not blanket refusal).
        s, body, _ = call(server, "GET", "/app.js", session=False)
        assert s == 200 and b"console.log(1)" in body


# ---------------------------------------------------------------------------
# §5.7.7 — symlink escape


class TestSymlinkEscape:
    def test_symlink_escape_contained(self, server, assets, tmp_path):
        outside = tmp_path / "outside-root"
        outside.mkdir()
        secret = outside / "secret.txt"
        secret.write_text(SECRET_MARK, encoding="utf-8")

        file_link = assets / "evil-file.txt"
        method = _make_link(file_link, secret, is_dir=False)
        if method is None:
            pytest.skip("symlink/junction creation unavailable on this host (privilege required)")
        s, body, _ = call(server, "GET", "/evil-file.txt", session=False)
        assert s == 404, f"file {method} escaped containment"
        if isinstance(body, bytes):
            assert SECRET_MARK.encode() not in body

        dir_link = assets / "evil-dir"
        method_d = _make_link(dir_link, outside, is_dir=True)
        if method_d is None:
            pytest.skip("directory link creation unavailable on this host")
        s, body, _ = call(server, "GET", "/evil-dir/secret.txt", session=False)
        assert s == 404, f"directory {method_d} escaped containment"
        if isinstance(body, bytes):
            assert SECRET_MARK.encode() not in body


# ---------------------------------------------------------------------------
# §5.7.8 — RCE: body fields are data, never shell


class TestRce:
    def test_shell_metacharacters_are_inert_data(self, server, tmp_path):
        # Probe path that would only exist if the string were shelled.
        marker = tmp_path / f"pwned-{secrets.token_hex(4)}"
        payloads = {
            "cmd": f";touch {marker}",
            "sub": f"$(touch {marker})",
            "bt": f"`touch {marker}`",
            "pipe": f"x | touch {marker}",
            "amp": f"x && touch {marker}",
        }
        status, env, _ = call(server, "POST", "/api/v1/echo", body=payloads)
        assert status == 200
        # The values round-trip verbatim — treated as strings, not syntax.
        assert env["data"]["received"] == payloads
        assert not marker.exists(), "payload was executed"

    def test_no_exec_primitives_in_module(self):
        # Structural guard: the vendored server must never gain a shell —
        # ops are typed callables, full stop. (webbrowser.open in serve()
        # is startup-only, fixed URL, never request-reachable.)
        src = Path(fp.__file__).read_text(encoding="utf-8")
        for forbidden in (
            "import subprocess",
            "subprocess.",
            "os.system",
            "os.popen",
            "os.spawn",
            "os.exec",
            "shell=True",
            "Popen(",
            "pty.",
        ):
            assert forbidden not in src, forbidden
        assert not re.search(r"\beval\s*\(", src)
        assert not re.search(r"\bexec\s*\(", src)


# ---------------------------------------------------------------------------
# §5.7.9 — SSRF: no outbound fetch path exists


class TestSsrf:
    def test_host_field_never_fetches(self, server, monkeypatch):
        # Structural: the vendored module has no outbound-fetch primitive.
        src = Path(fp.__file__).read_text(encoding="utf-8")
        for forbidden in (
            "urllib.request",
            "urlopen",
            "http.client",
            "import requests",
            "requests.",
            "socket.connect",
        ):
            assert forbidden not in src, forbidden

        # Behavioral: record every connect() during a request carrying an
        # attacker-controlled 'host' field — the only allowed destination
        # is the client's own loopback connection.
        connects: list = []
        real_connect = socket.socket.connect

        def spy(sock_self, address):
            connects.append(address)
            return real_connect(sock_self, address)

        monkeypatch.setattr(socket.socket, "connect", spy)
        hostile = "http://169.254.169.254/latest/meta-data"
        status, env, _ = call(server, "POST", "/api/v1/echo", body={"host": hostile})
        assert status == 200
        # Reached the handler as inert data — the server has no op that
        # dereferences it.
        assert env["data"]["received"]["host"] == hostile
        assert connects, "expected at least the client's own loopback connect"
        for addr in connects:
            assert isinstance(addr, tuple) and addr[0] in ("127.0.0.1", "localhost", "::1"), addr


# ---------------------------------------------------------------------------
# §5.7.10 — log injection


class TestLogInjection:
    def test_crlf_cannot_forge_log_lines(self, server, monkeypatch):
        logged: list[str] = []
        monkeypatch.setattr(server, "log", logged.append)

        # Encoded CRLF in the path — reaches the access log via requestline.
        s, _, _ = call(server, "GET", "/api/v1/probe%0d%0aFORGED-LINE")
        assert s == 404

        # Literal CRLF in a body field that flows through the error path.
        s, env, _ = call(
            server,
            "POST",
            "/api/v1/crash",
            body={"note": "line1\r\nFORGED-BODY-LINE"},
        )
        assert s == 500
        assert env["error"]["code"] == "PORTAL-INTERNAL"

        assert logged, "no log captured — cannot prove injection impossible"
        # Every emitted log record is a single line.
        assert all("\n" not in m and "\r" not in m for m in logged), logged
        # Body content never reaches the log at all.
        assert not any("FORGED-BODY-LINE" in m for m in logged), logged
        # Path content reaches the log only in percent-encoded form —
        # %0d%0a can never materialize as a real line break.
        assert any("%0d%0a" in m for m in logged), logged


# ---------------------------------------------------------------------------
# §5.7.11 — secret leakage / response scrubbing


class TestSecretLeakage:
    def test_secret_keys_redacted_in_response(self, server):
        status, env, _ = call(server, "GET", "/api/v1/secrets")
        assert status == 200
        data = env["data"]
        assert data["api_key"] == "«redacted»"
        assert data["nested"]["authorization"] == "«redacted»"
        assert data["nested"]["credential"] == "«redacted»"
        assert data["nested"]["inner"]["apikey"] == "«redacted»"
        assert data["nested"]["inner"]["session_token"] == "«redacted»"
        assert data["items"][0]["password"] == "«redacted»"
        # Non-secret data passes through untouched.
        assert data["items"][1]["safe"] == "shown"
        # plan_token is the documented exemption — it must round-trip.
        assert data["plan_token"] == "client-usable-plan-token"

    def test_redact_boundary_is_key_name_based(self):
        # Honest boundary: the scrubber matches key NAMES, not value shapes.
        # A secret-shaped value under a benign key passes through — pin this
        # so the limitation is documented, not silently assumed otherwise.
        out = fp.redact({"note": "AKIA-SHAPED-VALUE-UNDER-BENIGN-KEY"})
        assert out["note"] == "AKIA-SHAPED-VALUE-UNDER-BENIGN-KEY"
        # And SSE events pass through the same scrubber.
        assert fp.redact(_SECRET_PAYLOAD)["api_key"] == "«redacted»"


# ---------------------------------------------------------------------------
# §5.7.12 — plan replay


class TestPlanReplay:
    def test_plan_token_replay_is_idempotent_bound(self, server):
        token = _plan_token(server)
        s1, env1, _ = _apply(server, token)
        assert s1 == 200 and env1["data"]["status"] == "applied"
        # Observed: tokens are NOT single-use — a second apply within the
        # 15-min TTL succeeds. It is still idempotent-safe: the token is
        # bound to the exact signed plan, so replay can only re-execute the
        # identical action set (never a divergent one — §5.7.14).
        s2, env2, _ = _apply(server, token)
        assert s2 == 200 and env2["data"]["status"] == "applied"
        assert server.adapter.apply_count == 2


# ---------------------------------------------------------------------------
# §5.7.13 — expired / forged plan


class TestPlanExpiry:
    def test_stale_plan_token_rejected(self, server):
        # Valid signature, timestamp 1000 s in the past → beyond the 900 s TTL.
        stale = _crafted_token(server, PLAN_PROJECT, ts=int(time.time()) - 1000)
        status, env, _ = _apply(server, stale)
        assert status == 409
        assert env["error"]["code"] == "PORTAL-PLAN-STALE"
        assert server.adapter.apply_count == 0

    def test_forged_plan_token_rejected(self, server):
        for bad in ("fake.token", "a.b.c", secrets.token_urlsafe(24), ""):
            body = {"confirm": "apply", "plan_token": bad}
            status, env, _ = call(server, "POST", "/api/v1/installation/apply", body=body)
            assert status in (400, 409), bad
            assert env["error"]["code"] in ("PORTAL-PLAN-REQUIRED", "PORTAL-PLAN-STALE")
        assert server.adapter.apply_count == 0
        # Unit-level: a fresh token checked with a zero TTL is already stale.
        secret = b"x" * 32
        tok = fp.make_plan_token(secret, PLAN_PROJECT)
        assert fp.check_plan_token(secret, tok, PLAN_PROJECT, max_age_s=0) is False


# ---------------------------------------------------------------------------
# §5.7.14 — TOCTOU: plan token binds the exact plan


class TestToctou:
    def test_plan_a_token_cannot_apply_plan_b(self, server):
        # Token minted for a scope=account plan must not satisfy apply,
        # which verifies against its own scope=project plan.
        token_a = _plan_token(server, scope="account")
        status, env, _ = _apply(server, token_a)
        assert status == 409
        assert env["error"]["code"] == "PORTAL-PLAN-STALE"
        assert server.adapter.apply_count == 0
        # Sanity: the matching-scope token applies cleanly.
        token_b = _plan_token(server, scope="project")
        status, _, _ = _apply(server, token_b)
        assert status == 200
        assert server.adapter.apply_count == 1


# ---------------------------------------------------------------------------
# §5.7.15 — cancellation surface


class TestCancellation:
    def test_no_cancel_operation_surface(self, server):
        # The vendored Operation model has no cancel/lifecycle field.
        field_names = {f.name for f in dataclasses.fields(fp.Operation)}
        assert not any("cancel" in n for n in field_names)
        # No registered op exposes a cancel route.
        assert not any("cancel" in op.path for op in server.adapter.ops)
        # And nothing answers on the guessed route — surface absent.
        status, env, _ = call(server, "POST", "/api/v1/installation/cancel", body={})
        assert status == 404
        assert env["error"]["code"] == "PORTAL-NOT-FOUND"
        status, env, _ = call(server, "GET", "/api/v1/tasks/x/cancel")
        assert status == 404
        assert env["error"]["code"] == "PORTAL-NOT-FOUND"
        # MATRIX: UNVERIFIED — no cancel primitive exists in the vendored
        # backend to test; absence of the surface is what can be asserted.


# ---------------------------------------------------------------------------
# §5.7.16 — concurrency


class TestConcurrency:
    def test_parallel_mutations_bounded(self, server):
        n = fp.MUTATION_LIMIT + 2  # 12 parallel mutating calls — bounded
        with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
            results = list(
                pool.map(lambda _: call(server, "POST", "/api/v1/counter", body={}), range(n))
            )
        # Every call returned a structured envelope — no dropped/corrupt frames.
        assert all(env.get("schema") == fp.SCHEMA for _, env, _ in results)
        assert all(env.get("correlation_id") for _, env, _ in results)
        statuses = sorted(s for s, _, _ in results)
        # The limiter admits exactly MUTATION_LIMIT, refuses the rest —
        # deterministic under its lock, regardless of thread order.
        assert statuses == [200] * fp.MUTATION_LIMIT + [429, 429]
        ok_envs = [env for s, env, _ in results if s == 200]
        counts = sorted(env["data"]["count"] for env in ok_envs)
        # No interleaved corruption: each admitted mutation ran exactly once.
        assert counts == list(range(1, fp.MUTATION_LIMIT + 1))
        assert server.adapter.counter == fp.MUTATION_LIMIT
        for s, env, _ in results:
            if s == 429:
                assert env["error"]["code"] == "PORTAL-RATE-LIMITED"
        # Server survived the burst.
        s, _, _ = call(server, "GET", "/api/v1/health")
        assert s == 200


# ---------------------------------------------------------------------------
# §5.7.17 — resource exhaustion


class TestResourceExhaustion:
    def test_payload_cap_boundary(self, server):
        # Exactly 1 MiB of valid JSON → admitted (boundary is exclusive).
        fill = fp.MAX_BODY - len(b'{"pad":"') - len(b'"}')
        raw = b'{"pad":"' + b"x" * fill + b'"}'
        assert len(raw) == fp.MAX_BODY
        status, env, _ = call(server, "POST", "/api/v1/echo", raw_body=raw)
        assert status == 200
        assert len(env["data"]["received"]["pad"]) == fill

        # 1 MiB + 1 → refused before the body is even read.
        status, env, _ = call(server, "POST", "/api/v1/echo", raw_body=b" " * (fp.MAX_BODY + 1))
        assert status == 413
        assert env["error"]["code"] == "PORTAL-PAYLOAD-TOO-LARGE"
        # Server still healthy after the oversized attempt.
        s, _, _ = call(server, "GET", "/api/v1/health")
        assert s == 200
