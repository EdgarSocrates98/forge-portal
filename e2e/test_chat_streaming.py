"""Chat Studio streaming E2E (Cycle 30.2 §6/E) — real Chromium against the
real Forge Agent Bridge.

Boots a real bridge (fake provider — deterministic, real events through
real HTTP/SSE) and the real ``ng build`` bundle on ephemeral ports, then:

- sends a prompt through the actual Chat Studio UI (textarea → send)
- asserts mid-turn event stream via the bridge SSE endpoint from inside
  the browser (real EventSource semantics)
- verifies reconnect + dedup via Last-Event-ID (no repeated seqs)
- exercises cancel

Skips honestly when the bundle or Chromium is unavailable.
"""

import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "dist" / "forge-portal-app" / "browser"
FAB_REPO = REPO.parent / "forge-agent-bridge"
FAB_PY = Path(os.environ.get("FAB_PY", FAB_REPO / ".venv/bin/python"))
ARTIFACTS = Path(__file__).resolve().parent / "artifacts" / "chat_streaming"

pytestmark = pytest.mark.skipif(
    not BUNDLE.is_dir() or not FAB_PY.exists(),
    reason="portal bundle or bridge venv not built")

playwright = pytest.importorskip("playwright.sync_api",
                                 reason="playwright not installed")
from playwright.sync_api import sync_playwright  # noqa: E402


def _free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _req(url, method="GET", body=None, tok=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json",
                                        **({"Authorization": f"Bearer {tok}"}
                                           if tok else {})})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


@pytest.fixture(scope="module")
def stack():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    fab_state = Path(tempfile.mkdtemp(prefix="fab_stream_"))
    b_port, p_port = _free_port(), _free_port()
    bridge = f"http://127.0.0.1:{b_port}"
    portal = f"http://127.0.0.1:{p_port}"
    fab = subprocess.Popen(
        [str(FAB_PY), "-c",
         ("import pathlib,sys;import forge_agent_bridge.local_bridge as lb;"
          "lb.STATE_DIR=pathlib.Path(sys.argv[1]);"
          "open(sys.argv[1]+'/boot.log','w').write(lb.pair_token());"
          f"lb.serve({b_port})"), str(fab_state)],
        env={**os.environ, "FAB_ALLOWED_ORIGINS": portal},
        stdout=open(ARTIFACTS / "fab.log", "w"),
        stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{bridge}/status", timeout=1)
            break
        except Exception:
            time.sleep(0.3)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def send_head(self):
            if not os.path.isfile(self.translate_path(self.path)):
                self.path = "/index.html"
            return super().send_head()

        def log_message(self, *a):
            pass

    cwd = os.getcwd()
    os.chdir(BUNDLE)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", p_port), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    tok_pair = (fab_state / "boot.log").read_text().strip()
    _, b = _req(f"{bridge}/pair/exchange", "POST",
                {"pair_token": tok_pair, "device_name": "stream-e2e"})
    tok = b["session_token"]
    dev = b["device"]["device_id"]
    yield {"bridge": bridge, "portal": portal, "token": tok,
           "device": dev}
    httpd.shutdown()
    os.chdir(cwd)
    fab.terminate()


def test_chat_prompt_sse_dedup_cancel(stack):
    bridge, portal, tok = stack["bridge"], stack["portal"], stack["token"]

    # real fake-provider session (deterministic events through the API)
    st, s = _req(f"{bridge}/agent-sessions", "POST",
                 {"provider": "fake", "title": "stream-e2e"}, tok=tok)
    assert st == 201, s
    sid = s["id"]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context()
        pg = ctx.new_page()
        js_errors: list[str] = []
        pg.on("pageerror", lambda e: js_errors.append(str(e)))
        pg.goto(f"{portal}/pf/chat", wait_until="domcontentloaded")
        pg.evaluate(
            """([k1, v1, k2, v2, k3, v3]) => {
                localStorage.setItem(k1, v1);
                localStorage.setItem(k2, v2);
                localStorage.setItem(k3, v3);
            }""",
            ["fab.baseUrl", bridge, "fab.sessionToken", tok,
             "fab.deviceId", stack["device"]])
        pg.goto(f"{portal}/pf/chat", wait_until="networkidle")
        pg.screenshot(path=str(ARTIFACTS / "01_chat.png"))

        # select the session in the sidebar, then send via the composer
        pg.locator("button.sess", has_text="stream-e2e").first.click()
        pg.wait_for_timeout(800)
        # send a prompt through the real UI composer
        pg.locator("form.composer textarea").fill("say hello forge")
        pg.locator("form.composer").evaluate("f => f.requestSubmit()")
        pg.wait_for_timeout(3000)
        pg.screenshot(path=str(ARTIFACTS / "02_after_send.png"))
        body = pg.locator("body").inner_text()
        assert "say hello forge" in body, body[:300]

        # mid-turn SSE: read the stream inside the browser context —
        # real EventSource/fetch against the real bridge
        first = pg.evaluate(
            """async ([base, sid, tok]) => {
                const r = await fetch(
                    `${base}/agent-sessions/${sid}/stream?after_seq=0`,
                    {headers: {Authorization: `Bearer ${tok}`}});
                const txt = (await r.text()).slice(0, 4000);
                const seqs = [...txt.matchAll(/"seq":(\\d+)/g)]
                    .map(m => Number(m[1]));
                return {status: r.status, n_events: seqs.length, seqs,
                        has_event: txt.includes("event:")};
            }""",
            [bridge, sid, tok])
        assert first["status"] == 200
        assert first["n_events"] > 0, first

        # reconnect with Last-Event-ID = last seq → server emits only
        # later events (dedup — no replay of consumed seqs)
        last = first["seqs"][-1]
        second = pg.evaluate(
            """async ([base, sid, tok, last]) => {
                const r = await fetch(
                    `${base}/agent-sessions/${sid}/stream`,
                    {headers: {Authorization: `Bearer ${tok}`,
                               "Last-Event-ID": String(last)}});
                const txt = (await r.text()).slice(0, 4000);
                const seqs = [...txt.matchAll(/"seq":(\\d+)/g)]
                    .map(m => Number(m[1]));
                return {status: r.status, seqs};
            }""",
            [bridge, sid, tok, last])
        assert second["status"] == 200
        dup = [q for q in second["seqs"] if q <= last]
        assert not dup, f"replayed seqs after reconnect: {dup}"

        # cancel is a real endpoint — assert it responds 200
        st, c = _req(f"{bridge}/agent-sessions/{sid}/cancel", "POST",
                     {}, tok=tok)
        assert st == 200, c

        (ARTIFACTS / "stream_evidence.json").write_text(json.dumps({
            "session": sid, "first_seqs": first["seqs"],
            "reconnect_last": last,
            "post_reconnect_seqs": second["seqs"],
            "js_errors": js_errors}, indent=1))
        browser.close()
    assert not js_errors, js_errors


def test_diagnostics_page_renders_real_data(stack):
    """Diagnostic Center: provider records + MCP Doctor from the real
    bridge, including a deliberately broken MCP server classification."""
    bridge, portal, tok = stack["bridge"], stack["portal"], stack["token"]

    # seed a broken MCP server (revoked trust + invalid transport + error)
    st, _ = _req(f"{bridge}/mcp", "POST", {
        "schema": "forge/MCPServerDescriptor/1",
        "server_id": "broken-e2e", "name": "Broken E2E",
        "endpoint": "invalid-transport", "trust": "revoked",
        "capabilities": [], "required_scopes": []}, tok=tok)
    assert st in (200, 201)
    st, _ = _req(f"{bridge}/mcp/broken-e2e/health", "POST",
                 {"health": "error"}, tok=tok)
    assert st == 200

    # sanity: doctor classifies it before the browser round-trip
    st, doc = _req(f"{bridge}/mcp/doctor", "GET", tok=tok)
    assert st == 200
    broken = next(i for i in doc["items"] if i["server_id"] == "broken-e2e")
    assert broken["state"] == "error"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context()
        pg = ctx.new_page()
        js_errors: list[str] = []
        pg.on("pageerror", lambda e: js_errors.append(str(e)))
        pg.goto(f"{portal}/pf/diagnostics", wait_until="domcontentloaded")
        pg.evaluate(
            """([k1, v1, k2, v2, k3, v3]) => {
                localStorage.setItem(k1, v1);
                localStorage.setItem(k2, v2);
                localStorage.setItem(k3, v3);
            }""",
            ["fab.baseUrl", bridge, "fab.sessionToken", tok,
             "fab.deviceId", stack["device"]])
        pg.goto(f"{portal}/pf/diagnostics", wait_until="networkidle")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=str(ARTIFACTS / "03_diagnostics.png"),
                      full_page=True)
        body = pg.locator("body").inner_text()
        # providers table renders real detected providers
        assert "fake" in body and "codex" in body
        # MCP Doctor card renders the broken server + classification
        assert "broken-e2e" in body
        assert "credential" in body or "config" in body
        assert not js_errors, js_errors
        ctx.close()
        browser.close()
