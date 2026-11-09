"""Sentinel E2E — /api-operations against a REAL api-sentinel runtime.

Cycle 10 wave 3 (C10-F005): seeds a real api-sentinel workspace via the
installed CLI (install -> service/source -> ingest lab fixtures -> SLO
-> detect -> incident -> hypothesis ladder), serves it with bearer auth,
then drives Chromium through the real /api-operations journey:

  connection card -> services -> service detail -> incidents ->
  incident detail (+ladder/timeline) -> run investigation -> status

Deployment architecture proven here: the canonical portal server emits
CSP ``connect-src 'self'`` — a cross-origin api-sentinel can never be
reached from the served page. The e2e therefore fronts the bundle with
a same-origin ``/sentinel`` reverse proxy (the documented production
pattern): ``sentinel.baseUrl = <origin>/sentinel``, requests land
same-origin, the bearer header is forwarded by the proxy, and the
portal session cookie is stripped before forwarding.

No mocks anywhere in the chain: the browser's SentinelApi talks real
HTTP, the proxy talks real HTTP to the live uvicorn server, and every
assertion reads data the Sentinel workspace actually persisted.
Screenshots + a results JSON land in e2e/artifacts/ (consumed by
api-sentinel-forge evidence/portal-verification.json).

Run:  python -m pytest e2e/test_sentinel_e2e.py -q
      python e2e/test_sentinel_e2e.py          (standalone, artifacts)
"""

from __future__ import annotations

import http.server
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

playwright = pytest.importorskip("playwright.sync_api", reason="playwright not installed")
from playwright.sync_api import sync_playwright

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
BUNDLE = REPO / "dist" / "forge-portal-app" / "browser"

# --- real api-sentinel toolchain -----------------------------------------
SENTINEL_REPO = Path(
    os.environ.get("API_SENTINEL_REPO", REPO.parent / "api-sentinel-forge")
).resolve()
CLI = SENTINEL_REPO / ".venv" / "Scripts" / "api-sentinel.exe"
FIXTURES = SENTINEL_REPO / "lab" / "fixtures"
PORT = 8317  # the documented portal default

NOW = "2026-01-01T00:12:00Z"
T0 = "2026-01-01T00:00:00Z"
TOKEN = "portal-e2e-token-" + "0" * 32  # env-channel token, never in DOM/URL

RESULTS: dict = {"steps": [], "artifacts": [], "token_in_artifacts": False}


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["API_SENTINEL_TOKEN"] = TOKEN
    return env


def run(args: list[str], ws: Path, timeout: int = 120) -> dict:
    cmd = [str(CLI), *args, "--workspace", str(ws)]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, env=_env(), timeout=timeout, check=False
    )
    out = proc.stdout.strip()
    try:
        data = json.loads(out) if out else None
    except json.JSONDecodeError:
        data = None
    return {"rc": proc.returncode, "out": out, "err": proc.stderr.strip(), "json": data}


def _step(name: str, ok: bool, detail: str = "") -> None:
    RESULTS["steps"].append({"name": name, "ok": bool(ok), "detail": detail[:400]})


def remap(fixture: Path, tmp: Path, mapping: dict[str, str]) -> Path:
    text = fixture.read_text(encoding="utf-8")
    for old, new in mapping.items():
        text = text.replace(old, new)
    out = tmp / fixture.name
    out.write_text(text, encoding="utf-8")
    return out


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def wait_health(base: str, proc: subprocess.Popen, tries: int = 100) -> bool:
    for _ in range(tries):
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(f"{base}/v1/health", timeout=2) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)
    return False


# ---------------------------------------------------------------------------
# same-origin /sentinel reverse proxy — the connect-src 'self' answer
# ---------------------------------------------------------------------------

_HOP_BY_HOP = frozenset(
    h.lower()
    for h in (
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailers", "transfer-encoding", "upgrade", "host", "cookie",
        "origin", "referer",
    )
)


def make_handler(bundle: Path, sentinel_base: str, prefix: str = "/sentinel"):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(bundle), **kw)

        def log_message(self, *a):  # quiet
            pass

        def _proxy(self):
            path = self.path[len(prefix):] or "/"
            body = None
            if self.command == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b"{}"
            headers = {
                k: v
                for k, v in self.headers.items()
                if k.lower() not in _HOP_BY_HOP
            }
            req = urllib.request.Request(
                f"{sentinel_base}{path}", data=body, headers=headers,
                method=self.command,
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    payload = r.read()
                    status = r.status
                    ctype = r.headers.get("Content-Type", "application/json")
            except urllib.error.HTTPError as e:
                payload = e.read()
                status = e.code
                ctype = e.headers.get("Content-Type", "application/json")
            except OSError as e:
                payload = json.dumps(
                    {"title": "proxy error", "detail": str(e), "status": 502}
                ).encode()
                status, ctype = 502, "application/json"
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path.startswith(prefix):
                return self._proxy()
            if self.path.startswith("/api/"):
                # Product Forge absent by design — Sentinel must render
                # fully anyway (the two provenances stay independent).
                payload = json.dumps(
                    {"schema": "forge/PortalApi/1", "correlation_id": "e2e",
                     "error": {"code": "PF-UNAVAILABLE",
                               "message": "product forge not wired in this e2e"}}
                ).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            return super().do_GET()

        def do_POST(self):
            if self.path.startswith(prefix):
                return self._proxy()
            self.send_error(404)

        def do_OPTIONS(self):
            # same-origin traffic never needs CORS; answer defensively anyway
            self.send_response(204)
            self.end_headers()

        def send_head(self):
            # SPA fallback: unknown non-asset paths serve index.html so
            # /api-operations deep links resolve under the client router.
            path = self.translate_path(self.path)
            if self.path == "/" or (
                not Path(path).exists() and "." not in Path(self.path).name
            ):
                self.path = "/index.html"
            return super().send_head()

    return Handler


@pytest.fixture(scope="module")
def portal_static():
    """Bundle + same-origin /sentinel proxy on an ephemeral port."""
    if not BUNDLE.is_dir():
        pytest.skip("dist/forge-portal-app/browser missing — run `ng build` first")
    handler = make_handler(BUNDLE, f"http://127.0.0.1:{PORT}")
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", free_port()), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    RESULTS["portal_origin"] = f"http://127.0.0.1:{srv.server_address[1]}"
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


# ---------------------------------------------------------------------------
# fixture: real sentinel workspace + served API (no mocks)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def sentinel(portal_static):
    """Seed + serve a REAL api-sentinel workspace."""
    if not CLI.exists():
        pytest.skip(f"api-sentinel CLI missing: {CLI}")
    if not FIXTURES.is_dir():
        pytest.skip(f"lab fixtures missing: {FIXTURES}")

    work = Path(tempfile.mkdtemp(prefix="portal-sentinel-e2e-"))
    ws = work / "ws"
    tmp = work / "fixtures"
    tmp.mkdir(parents=True)
    RESULTS["workspace"] = str(ws)

    c = run(["install", "--yes", "--json"], ws)
    _step("install", c["rc"] == 0 and (ws / "sentinel.db").exists(), c["out"][:200])

    svc: dict[str, str] = {}
    for name in ("payments-api", "checkout-api"):
        c = run(["services", "--register", name, "--json"], ws)
        svc[name] = str((c["json"] or {}).get("service_id", ""))
    _step("services register", all(svc.values()), json.dumps(svc))

    src: dict[str, str] = {}
    for name, service_id in svc.items():
        c = run(["sources", "--register", "jsonl-file", "--service-id", service_id, "--json"], ws)
        src[name] = str((c["json"] or {}).get("source_id", ""))
    _step("sources register", all(src.values()), json.dumps(src))

    lab001 = remap(
        FIXTURES / "lab-001-elevated-latency.jsonl", tmp,
        {"svc_lab_payments": svc["payments-api"], "src_lab_jsonl": src["payments-api"]},
    )
    lab004 = remap(
        FIXTURES / "lab-004-regressive-deploy" / "observations.jsonl", tmp,
        {"svc_lab_checkout": svc["checkout-api"], "src_lab_jsonl": src["checkout-api"]},
    )
    ok = True
    for name, f, want in (("payments-api", lab001, 8), ("checkout-api", lab004, 18)):
        c = run(["ingest", "--source-id", src[name], "--file", str(f), "--json"], ws)
        ok = ok and (c["json"] or {}).get("accepted") == want
    _step("ingest fixtures", ok, "accepted 8+18 observations")

    manifest = FIXTURES / "lab-004-regressive-deploy" / "deploy-manifest.json"
    if manifest.exists():
        c = run(["changes", "import", "--file", str(manifest), "--json"], ws)
        _step("changes import", (c["json"] or {}).get("imported") == 2, c["out"][:200])

    c = run(
        ["slo", "define", "--service-id", svc["payments-api"],
         "--target", "0.99", "--window", "1h", "--json"], ws,
    )
    slo_id = str((c["json"] or {}).get("slo_id", ""))
    _step("slo define", bool(slo_id), slo_id)
    if slo_id:
        c = run(
            ["slo", "evaluate", "--slo-id", slo_id,
             "--window-start", T0, "--window-end", "2026-01-01T01:00:00Z", "--json"], ws,
        )
        _step("slo evaluate", c["rc"] == 0, str((c["json"] or {}).get("state")))

    # detect -> anomalies -> auto-correlated incidents (deterministic clock)
    det_ok = True
    for name, (a, b) in (
        ("payments-api", (T0, "2026-01-01T00:08:00Z")),
        ("checkout-api", ("2026-01-01T00:04:00Z", "2026-01-01T00:10:00Z")),
    ):
        c = run(["detect", "--service-id", svc[name], "--window-start", a,
                 "--window-end", b, "--now", NOW, "--json"], ws)
        det_ok = det_ok and bool((c["json"] or {}).get("anomalies"))
    _step("detect anomalies", det_ok, "")

    c = run(["incidents", "--json"], ws)
    incs = c["json"] if isinstance(c["json"], list) else []
    inc = next(
        (i for i in incs if i.get("service_id") == svc["checkout-api"]), incs[0] if incs else {},
    )
    inc_id = str(inc.get("incident_id", ""))
    _step("incident exists", bool(inc_id), inc_id)

    # change-correlated hypothesis -> verification -> promotion (ladder data)
    if inc_id:
        c = run(["changes", "correlate", "--incident-id", inc_id, "--json"], ws)
        cands = (c["json"] or {}).get("candidates") or []
        change_id = str((cands[0].get("change") or {}).get("change_id", "")) if cands else ""
        if change_id:
            c = run(
                ["hypotheses", "add", "--incident-id", inc_id,
                 "--text", "deploy sha_a11ce99 (v2.7.0) preceded the regression",
                 "--confidence", "CORRELATED", "--evidence-for", change_id, "--json"], ws,
            )
            hyp_id = str((c["json"] or {}).get("hypothesis_id", ""))
            _step("hypothesis CORRELATED", bool(hyp_id), hyp_id)
            if hyp_id:
                c = run(
                    ["hypotheses", "verify", "--incident-id", inc_id,
                     "--hypothesis-id", hyp_id,
                     "--window-start", "2026-01-01T00:10:00Z",
                     "--window-end", "2026-01-01T00:12:00Z", "--json"], ws,
                )
                ver_id = str((c["json"] or {}).get("verification_id", ""))
                if ver_id:
                    c = run(
                        ["hypotheses", "promote", "--incident-id", inc_id,
                         "--hypothesis-id", hyp_id, "--verification-id", ver_id, "--json"], ws,
                    )
                    _step("hypothesis VERIFIED",
                          (c["json"] or {}).get("confidence") == "VERIFIED", "")

    base = f"http://127.0.0.1:{PORT}"
    proc = subprocess.Popen(
        [str(CLI), "serve", "--host", "127.0.0.1", "--port", str(PORT),
         "--workspace", str(ws)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=_env(),
    )
    RESULTS["server_pid"] = proc.pid
    RESULTS["server_base"] = base
    up = wait_health(base, proc)
    _step("serve /v1", up, f"pid={proc.pid} on {base}")
    if not up:
        proc.terminate()
        pytest.fail(f"sentinel serve failed on {base}")

    yield {
        "base": base,
        "proxy_base": f"{portal_static}/sentinel",
        "token": TOKEN,
        "svc": svc,
        "src": src,
        "incident_id": inc_id,
        "ws": ws,
    }
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    RESULTS["server_log_tail"] = (proc.stdout.read() if proc.stdout else "")[-2000:]


@pytest.fixture(scope="module")
def pw():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture(scope="module", autouse=True)
def _results_sink():
    """Always land the evidence file — even on failure (honest artifact)."""
    yield
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    RESULTS["verdict"] = "pass" if all(s["ok"] for s in RESULTS["steps"]) else "fail"
    (ARTIFACTS / "sentinel-e2e-results.json").write_text(
        json.dumps(RESULTS, indent=2), encoding="utf-8"
    )


def _shot(page, name: str) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    path = ARTIFACTS / f"{name}.png"
    page.screenshot(path=str(path), full_page=False)
    RESULTS["artifacts"].append(path.name)


def _open(page, url: str) -> None:
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)


# ---------------------------------------------------------------------------
# the golden path — every pane driven by the live /v1 surface
# ---------------------------------------------------------------------------


def test_sentinel_golden_path(portal_static, sentinel, pw):
    page = pw.new_page()
    token_leaks: list[str] = []
    page.on("console", lambda m: token_leaks.append(m.text) if TOKEN in m.text else None)
    # deterministic locale — assertions match the EN dictionary
    page.add_init_script("localStorage.setItem('forge-portal.locale','en')")
    try:
        _open(page, f"{portal_static}/api-operations")

        # 1) connection card — real same-origin proxy base + bearer via UI
        page.get_by_role("button", name="Sentinel connection").first.click()
        page.locator(".conn input").nth(0).fill(sentinel["proxy_base"])
        page.locator(".conn input").nth(1).fill(sentinel["token"])
        page.get_by_role("button", name="Test connection").click()
        page.wait_for_selector(".conn .ok", timeout=15000)
        assert "api-sentinel" in page.locator(".conn .ok").inner_text()
        _shot(page, "sentinel-00-connected")
        _step("ui connection card", True, "typed proxy base+token, test connected")
        page.get_by_role("button", name="Save").click()
        page.wait_for_timeout(600)
        # close the card — evidence should show the wired surface
        page.locator(".conn .btn--icon").click()
        page.wait_for_timeout(300)

        # 2) services tab — real inventory rows from /v1/services
        page.wait_for_selector("tr.row", timeout=15000)
        body = page.locator("body").inner_text()
        assert "payments-api" in body or "checkout-api" in body
        _shot(page, "sentinel-01-services")
        _step("services inventory", True, "rows render real service ids")

        # 3) service detail — operations, metrics windows, SLO chip, sources
        page.locator("tr.row").first.click()
        page.wait_for_selector(".hero", timeout=15000)
        detail = page.locator("body").inner_text()
        assert "orrespondence" in detail  # Product Forge correspondence
        _shot(page, "sentinel-02-service-detail")
        _step("service detail", True, "hero+indicators+panels render")
        page.get_by_role("button", name="Back to services").click()
        page.wait_for_selector("tr.row", timeout=10000)

        # 4) incidents tab -> incident detail -> ladder + timeline
        page.locator(".tab").nth(1).click()
        page.wait_for_selector("tr.row", timeout=15000)
        _shot(page, "sentinel-03-incidents")
        page.locator("tr.row").first.click()
        page.wait_for_selector(".timeline", timeout=15000)
        page.locator(".timeline").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        idetail = page.locator("body").inner_text()
        assert "Hypotheses" in idetail
        assert "Timeline" in idetail
        _shot(page, "sentinel-04-incident-detail")
        _step("incident detail", True, "hypotheses ladder + timeline render")

        # 5) authorized investigation — the mutation path, scope-gated
        page.get_by_role("button", name="Run investigation").click()
        page.wait_for_selector(".pack, .unknowns", timeout=45000)
        _shot(page, "sentinel-05-investigation")
        itext = page.locator("body").inner_text()
        _step(
            "investigation run",
            "Completed" in itext or "COMPLETED" in itext,
            "POST /v1/incidents/<id>/investigations",
        )

        # 6) status tab — health + capabilities + stage + integrations + sources
        page.locator(".tab").nth(2).click()
        page.wait_for_selector("section.card", timeout=15000)
        page.wait_for_timeout(800)
        stext = page.locator("body").inner_text()
        _shot(page, "sentinel-06-status")
        _step(
            "status surface",
            "Capabilities" in stext and "Stage" in stext,
            "capabilities render with stage column",
        )

        # honesty: the bearer never lands in the DOM or console
        leaked = page.evaluate(
            "(tok) => document.body.innerHTML.includes(tok)", TOKEN
        )
        _step("token not in DOM/console", not leaked and not token_leaks,
              f"dom={leaked} console={len(token_leaks)}")
        RESULTS["token_in_artifacts"] = bool(leaked or token_leaks)
    finally:
        page.close()

    failures = [s for s in RESULTS["steps"] if not s["ok"]]
    assert not failures, f"e2e steps failed: {[f['name'] for f in failures]}"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q", "-s"]))
