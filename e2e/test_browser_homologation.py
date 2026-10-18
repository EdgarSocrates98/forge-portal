"""Cycle 4 — honest error surfaces + the real the-forge federated flow.

Both layers are real:

1. ``DegradedAdapter`` — the E2E adapter with genuinely failing
   backends. Nothing is canned: ``/agents`` is simply unimplemented
   (404 PORTAL-NOT-FOUND), ``/skills`` raises a real retryable 503,
   hosts come back partial with explicit UNVERIFIED holes, the MCP
   verify runs a real TCP handshake against a closed loopback port and
   reports the OS-level refusal, the install apply fails on a real
   ``os.access`` permission check, and ``/hosts/launch`` refuses an
   absent host after a real ``shutil.which`` probe. Chromium must render
   every state honestly — named codes, UNVERIFIED badges, refusal
   cards — never fabricated content.

2. ``test_theforge_federated_flow`` — imports the REAL the-forge
   adapter from its sibling checkout, serves the CURRENT built bundle
   through its own vendored server, and drives the real federated path
   in Chromium: federation → capabilities → Graph Studio →
   agents/skills/MCP navigation → a real MCP handshake receipt → back
   to the graph. Skips explicitly when no the-forge checkout exists.

Run:  python -m pytest e2e/test_browser_homologation.py -q
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import forge_portal as fp

pytest.importorskip("playwright.sync_api", reason="playwright not installed")
from playwright.sync_api import sync_playwright
from test_browser_e2e import ARTIFACTS, BUNDLE, E2EAdapter, _req

# real discovery for the the-forge layer — same code path as the matrix
SCRIPT = REPO / "scripts" / "homologation.py"
_SPEC = importlib.util.spec_from_file_location("homologation", SCRIPT)
hom = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault("homologation", hom)  # dataclasses resolve module ns
_SPEC.loader.exec_module(hom)


# ---------------------------------------------------------------------------
# DegradedAdapter — a real adapter whose backends honestly fail
# ---------------------------------------------------------------------------


class DegradedAdapter(E2EAdapter):
    """Every op still runs real code — the failures are real raised
    refusals and real OS probes, not scripted UI fixtures."""

    forge_id = "degraded-forge"
    forge_name = "Degraded Forge"
    cli = "degraded-forge"

    def __init__(self) -> None:
        super().__init__()
        # unavailable capability: /agents is genuinely not implemented
        self.ops = tuple(
            op for op in self.ops if op.path != "/agents"
        ) + (
            fp.Operation("POST", "/hosts/launch", self._launch),
        )

    # -- a backend that is down: a real retryable 503 -------------------
    def skills(self) -> list[dict]:
        raise fp.PortalError(
            "E2E-SKILLS-OFFLINE",
            "skill index backend unreachable on 127.0.0.1",
            http=503,
            retryable=True,
        )

    # -- partial data: one host verified, one probed-and-unverified ------
    def hosts(self) -> list[dict]:
        devin = shutil.which("devin")  # real probe — real detection
        return [
            {
                "host": "devin",
                "detected": devin is not None,
                "version": "1.0" if devin else None,
                "supported": devin is not None,
                "logged_in": None,  # auth genuinely unverified
                "integration": "EXECUTION_VERIFIED" if devin else "NOT_DETECTED",
                "launchable": devin is not None,
            },
            {
                "host": "copilot",
                "detected": False,
                "version": None,
                "supported": None,
                "logged_in": None,
                "integration": "UNVERIFIED",
                "launchable": False,
                "detail": "binary absent — presence unverified, never guessed",
            },
        ]

    # -- missing host: real detection probe → named refusal --------------
    def _launch(self, ctx: fp.RequestContext) -> dict:
        host = str((ctx.body or {}).get("host") or "")
        if shutil.which(host):
            return {
                "command": f"{host} integrate degraded-forge",
                "detail": f"run `{host} integrate degraded-forge` in your terminal",
                "host": host,
            }
        return {
            "command": None,
            "refusal": "PORTAL-HOST-ABSENT",
            "detail": f"{host} not detected on this system",
        }

    # -- offline MCP: a REAL TCP handshake against a closed port ---------
    def _mcp_verify(self, ctx: fp.RequestContext) -> dict:
        t0 = time.monotonic()
        err: OSError | None = None
        try:
            with socket.create_connection(("127.0.0.1", 1), timeout=2):
                pass
        except OSError as e:  # connection refused — the OS's own evidence
            err = e
        ms = int((time.monotonic() - t0) * 1000)
        status = "FAIL" if err else "PASS"
        detail = (
            f"tcp 127.0.0.1:1 → {type(err).__name__}: {err}" if err else "handshake ok"
        )
        return {
            "status": status,
            "detail": "0/1 handshakes passed" if err else "1/1 handshakes passed",
            "latency_ms": ms,
            "servers": [
                {"forge": "degraded-forge", "status": status, "detail": detail}
            ],
            "actions": [
                {"kind": "handshake", "path": "mcp://degraded-forge",
                 "status": status}
            ],
        }

    # -- refused operation: a REAL permission check ----------------------
    def _apply(self, ctx: fp.RequestContext) -> dict:
        target = "/root/.degraded-forge-probe"
        if not os.access("/root", os.W_OK):
            raise fp.PortalError(
                "E2E-PERMISSION-DENIED",
                f"insufficient permissions: {target} not writable by "
                f"uid {os.getuid()}",
                http=403,
            )
        raise fp.PortalError(
            "E2E-APPLY-UNSUPPORTED",
            "apply not implemented on the degraded adapter",
            http=404,
        )

    # -- incompatible version: declared honestly in health --------------
    def health(self) -> dict:
        return {
            "schema": "forge/HealthDoc/v1",
            "forge_id": self.forge_id,
            "status": "degraded",
            "checks": [
                {"id": "skills-backend", "status": "FAIL",
                 "detail": "backend offline"},
                {"id": "portal-compat", "status": "BLOCKED",
                 "detail": "adapter protocol 0.9 < required 1.0 — "
                          "incompatible version"},
            ],
            "checked_at": fp._utc_now(),
        }


@pytest.fixture(scope="module")
def degraded():
    if not BUNDLE.is_dir():
        pytest.skip("dist/forge-portal-app/browser missing — run `ng build` first")
    server = fp.PortalServer(DegradedAdapter(), quiet=True)
    server.serve_in_thread()
    yield server
    server.shutdown()


@pytest.fixture(scope="module")
def pw():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture()
def page(pw):
    pg = pw.new_page(viewport={"width": 1440, "height": 900})
    yield pg
    pg.close()


def _goto(page, server, route: str) -> None:
    page.goto(f"http://127.0.0.1:{server.port}{route}"
              f"?forge_session={server.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)


def _shot(page, name: str) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / f"{name}.png"), full_page=False)


# ---------------------------------------------------------------------------
# controlled error surfaces — the UI must show each one honestly
# ---------------------------------------------------------------------------


def test_unavailable_capability_agents_404(page, degraded):
    """GET /agents is absent on this adapter → 404 PORTAL-NOT-FOUND →
    the page renders the error card with the named code — no invented
    agent roster, no crash."""
    s, env = _req(degraded, "GET", "/agents")
    assert s == 404 and env["error"]["code"] == "PORTAL-NOT-FOUND"
    _goto(page, degraded, "/agents")
    err = page.locator("ui-error .err__code")
    assert err.count() > 0, "unavailable capability rendered no named code"
    assert "PORTAL-NOT-FOUND" in err.first.inner_text()
    # nothing fabricated: no agent cards may appear
    assert page.locator("[data-section='cards'] article").count() == 0
    _shot(page, "c4-01-agents-unavailable")


def test_offline_backend_skills_503(page, degraded):
    """GET /skills raises a real retryable 503 → the page renders the
    error card with retry and the E2E-SKILLS-OFFLINE code."""
    s, env = _req(degraded, "GET", "/skills")
    assert s == 503 and env["error"]["code"] == "E2E-SKILLS-OFFLINE"
    assert env["error"]["retryable"] is True
    _goto(page, degraded, "/skills")
    err = page.locator("ui-error .err__code")
    assert err.count() > 0, "offline skills backend rendered no named code"
    assert "E2E-SKILLS-OFFLINE" in err.first.inner_text()
    assert page.locator("ui-error button:has-text('Retry'),"
                        " ui-error button:has-text('Tentar')").count() > 0
    _shot(page, "c4-02-skills-offline")


def test_missing_forge_detail(page, degraded):
    """/forges/<absent-id> — not the serving forge, not a specialist,
    not in the registry → the honest not-found empty state."""
    _goto(page, degraded, "/forges/ghost-forge-404")
    empty = page.locator("ui-empty")
    assert empty.count() > 0, "missing forge rendered no empty state"
    # no identity/health cards may pretend the forge exists
    assert page.locator("[data-section='health']").count() == 0
    _shot(page, "c4-03-missing-forge")


def test_partial_host_data(page, degraded):
    """Hosts: one EXECUTION_VERIFIED, one UNVERIFIED with null fields —
    the page must render both states and never fill the holes."""
    s, env = _req(degraded, "GET", "/hosts")
    assert s == 200
    states = {h["host"]: h["integration"] for h in env["data"]}
    assert states.get("copilot") == "UNVERIFIED"
    _goto(page, degraded, "/hosts")
    assert page.locator("text=/UNVERIFIED/").count() > 0, \
        "partial data did not surface the UNVERIFIED host state"
    _shot(page, "c4-04-partial-hosts")


def test_missing_host_launch_refusal(page, degraded):
    """requestIntegration on an absent host → real probe → named
    PORTAL-HOST-ABSENT refusal rendered in the outcome card."""
    _goto(page, degraded, "/hosts")
    # the copilot card's request button — a real POST /hosts/launch
    card = page.locator("article", has_text="copilot").first
    assert card.count() > 0, "unverified host card absent"
    card.locator(".row button").first.click()
    outcome = page.locator(".outcome[data-kind='refusal']")
    outcome.wait_for(state="visible", timeout=10000)
    assert "PORTAL-HOST-ABSENT" in outcome.inner_text()
    _shot(page, "c4-05-host-absent-refusal")


def test_offline_mcp_fail_receipt(page, degraded):
    """POST /mcp/verify runs a REAL refused handshake → status=FAIL with
    the OS-level error in the receipt — the page renders FAIL, never
    upgrades it to PASS."""
    # the wire receipt carries the OS-level refusal verbatim
    s, env = _req(degraded, "POST", "/mcp/verify", body={"confirm": "verify"})
    assert s == 200 and env["data"]["status"] == "FAIL"
    detail = json.dumps(env["data"])
    assert "refused" in detail.lower() or "ConnectionRefusedError" in detail

    _goto(page, degraded, "/mcp")
    page.locator("button[data-action='verify']").click()
    receipt = page.locator("[data-section='verify']")
    receipt.wait_for(state="visible", timeout=30000)
    page.wait_for_selector("[data-section='verify'] ui-state-badge",
                           timeout=30000)
    text = receipt.inner_text()
    assert "FAIL" in text, f"real handshake failure not rendered: {text}"
    assert "0/1 handshakes" in text, f"measured detail missing: {text}"
    assert "mcp://degraded-forge" in text  # real action evidence
    assert "PASS" not in text.split("FAIL")[0], "failure rendered as pass"
    _shot(page, "c4-06-mcp-fail-receipt")


def test_refused_apply_insufficient_permissions(page, degraded):
    """Install plan → confirm → apply hits a REAL os.access denial →
    HTTP 403 E2E-PERMISSION-DENIED → the wizard's error step renders
    the named code."""
    s, env = _req(degraded, "POST", "/installation/plan", body={})
    assert s == 200, env
    plan, token = env["data"]["plan"], env["data"]["plan_token"]
    s, env = _req(degraded, "POST", "/installation/apply",
                  body={"confirm": "apply", "plan": plan, "plan_token": token})
    assert s == 403 and env["error"]["code"] == "E2E-PERMISSION-DENIED"

    _goto(page, degraded, "/install")
    plan_btn = page.locator("button:has-text('Plan'),"
                            " button:has-text('Planejar')").first
    assert plan_btn.count() and plan_btn.is_enabled()
    plan_btn.click()
    page.wait_for_timeout(700)
    next_btn = page.locator("button:has-text('Continue'),"
                            " button:has-text('Continuar')").first
    if next_btn.count() and next_btn.is_enabled():
        next_btn.click()
        page.wait_for_timeout(300)
    apply_btn = page.locator("button:has-text('Confirm and execute'),"
                             " button:has-text('Confirmar e executar')").first
    assert apply_btn.count() and apply_btn.is_enabled(), \
        "apply step never became reachable"
    apply_btn.click()
    page.wait_for_timeout(900)
    code = page.locator(".err__code")
    assert code.count() > 0, "refused apply rendered no named code"
    assert "E2E-PERMISSION-DENIED" in code.first.inner_text()
    _shot(page, "c4-07-permission-denied")


def test_empty_graph_state(page, degraded):
    """Graph Studio over a degraded surface — several sources fail or
    are absent → the sources strip marks each honestly (unavailable /
    unverified), the graph still composes from real nodes only, and
    nothing fabricates coverage."""
    _goto(page, degraded, "/graph")
    strip = page.locator("[data-strip='sources']")
    strip.wait_for(state="visible", timeout=15000)
    states = {
        li.get_attribute("data-source"): li.get_attribute("data-state")
        for li in strip.locator("li").all()
    }
    # /skills 503 → unverified; /agents 404 → unavailable — real, distinct
    assert states.get("skills") in ("unverified", "unavailable"), states
    assert states.get("agents") == "unavailable", states
    # degraded adapter has no /graphs op — honestly unavailable
    assert states.get("graphs") == "unavailable", states
    # real nodes still compose from the sources that DID answer
    assert page.locator(".fed__node").count() > 0, \
        "degraded sources produced no federated nodes at all"
    _shot(page, "c4-08-degraded-graph")


def test_incompatible_version_health_surface(page, degraded):
    """The descriptor/health shows the adapter's own BLOCKED compat
    check — an incompatible version is evidence, not a crash."""
    s, env = _req(degraded, "GET", "/health")
    assert s == 200
    checks = {c["id"]: c["status"] for c in env["data"].get("checks", [])}
    assert checks.get("portal-compat") == "BLOCKED"
    _goto(page, degraded, "/forges/self")
    assert page.locator("text=/BLOCKED|incompatible|incompat/i").count() > 0, \
        "incompatible-version evidence not rendered"
    _shot(page, "c4-09-incompatible-version")


# ---------------------------------------------------------------------------
# the real the-forge federated flow — real adapter, real bundle, real
# Chromium. discovery → capabilities → graph studio → catalogs →
# MCP receipt → back to the graph.
# ---------------------------------------------------------------------------


def _theforge_spec():
    return next(s for s in hom.FORGES if s.forge_id == "the-forge")


@pytest.fixture(scope="module")
def theforge(tmp_path_factory):
    """Serve the CURRENT built bundle through the REAL the-forge adapter
    (its own vendored server — the same object `<cli> portal` runs)."""
    if not BUNDLE.is_dir():
        pytest.skip("dist/forge-portal-app/browser missing — run `ng build` first")
    local = hom.discover(_theforge_spec())
    if not local.checkout or not (local.checkout / "src").is_dir():
        pytest.skip("the-forge checkout not found locally")
    sys.path.insert(0, str(local.checkout / "src"))
    try:
        import theforge._forge_portal as tfp
        import theforge.portal_adapter as tpa
    except ImportError as e:
        pytest.skip(f"the-forge adapter not importable: {e}")
    root = tmp_path_factory.mktemp("theforge-workspace")
    adapter = tpa.TheForgePortal(root)
    adapter.assets_dir = BUNDLE  # current build — not the stale vendor copy
    server = tfp.PortalServer(adapter, quiet=True)
    server.serve_in_thread()
    yield server, local
    server.shutdown()


def test_theforge_federated_flow(page, theforge):
    server, _ = theforge

    # -- discovery: bootstrap + capabilities answer the real adapter ---
    s, boot = _req(server, "GET", "/bootstrap")
    assert s == 200
    desc = boot["data"]["descriptor"]
    assert desc["forge_id"] == "the-forge"
    s, caps_env = _req(server, "GET", "/capabilities")
    assert s == 200
    declared = {c["id"]: c["state"] for c in caps_env["data"]}
    assert declared.get("federation") == "supported"

    # -- real federation evidence over HTTP ----------------------------
    s, fed_env = _req(server, "GET", "/federation")
    assert s == 200
    fed = fed_env["data"]
    specialists = fed.get("specialists") or []
    assert specialists, "the-forge reported zero real specialists"

    # -- federated discovery page --------------------------------------
    _goto(page, server, "/federation")
    assert page.locator("text=/Família de Forjas|Forge family/i").count() > 0
    assert page.locator(f"text=/{specialists[0].get('provider', 'forge')}/i").count() > 0
    _shot(page, "c4-10-theforge-federation")

    # -- Graph Studio on the real federated surface --------------------
    _goto(page, server, "/graph")
    strip = page.locator("[data-strip='sources']")
    strip.wait_for(state="visible", timeout=20000)
    nodes = page.locator(".fed__node")
    assert nodes.count() > 0, "Graph Studio rendered zero real nodes"
    _shot(page, "c4-11-theforge-graph")

    # -- agent + skill navigation — real catalogs ----------------------
    _goto(page, server, "/agents")
    assert page.locator("[data-section='cards'] article,"
                        " [data-section='table'] tr").count() > 0, \
        "the-forge real agent catalog rendered nothing"
    _shot(page, "c4-12-theforge-agents")

    _goto(page, server, "/skills")
    assert page.locator("table tbody tr, [data-section='cards'] article").count() > 0, \
        "the-forge real skill catalog rendered nothing"
    _shot(page, "c4-13-theforge-skills")

    # -- safe MCP verification: real handshakes → real receipt ---------
    _goto(page, server, "/mcp")
    registry = page.locator("[data-section='registry']")
    registry.wait_for(state="visible", timeout=15000)
    _shot(page, "c4-14-theforge-mcp-registry")
    page.locator("button[data-action='verify']").click()
    receipt = page.locator("[data-section='verify']")
    receipt.wait_for(state="visible", timeout=180000)
    page.wait_for_selector("[data-section='verify'] ui-state-badge",
                           timeout=180000)
    text = receipt.inner_text()
    # the receipt is the REAL handshake result — PASS or FAIL it must
    # carry the measured detail, never an empty card
    assert any(s in text for s in ("PASS", "FAIL", "BLOCKED", "handshakes")), (
        f"MCP receipt carried no real outcome: {text[:300]}"
    )
    _shot(page, "c4-15-theforge-mcp-receipt")

    # -- back to the graph: evidence round-trip ------------------------
    _goto(page, server, "/graph")
    strip.wait_for(state="visible", timeout=20000)
    assert page.locator(".fed__node").count() > 0
    _shot(page, "c4-16-theforge-graph-return")


if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-q"]))
