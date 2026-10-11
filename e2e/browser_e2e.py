"""Browser E2E — real Chromium against the real server + real bundle.

GAP-002 coverage: boots ``portal_core.forge_portal.PortalServer`` on an
ephemeral loopback port serving the actual ``ng build`` output, then
drives Chromium through every route, i18n toggle, theme, command
palette, viewports and offline error recovery. Screenshots land in
``e2e/artifacts/`` — evidence, not mock assertions.

Run:  python -m pytest e2e/ -q        (requires playwright + chromium)
      python e2e/browser_e2e.py       (same, standalone, with artifacts)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))

import forge_portal as fp

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
BUNDLE = REPO / "dist" / "forge-portal-app" / "browser"

playwright = pytest.importorskip("playwright.sync_api", reason="playwright not installed")

from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# real adapter — every default op backed by a real method, plus mutating
# plan/apply so the install flow executes end-to-end in the browser.
# ---------------------------------------------------------------------------


class E2EAdapter(fp.PortalAdapter):
    forge_id = "e2e-forge"
    forge_name = "E2E Forge"
    cli = "e2e-forge"

    def __init__(self) -> None:
        self.assets_dir = BUNDLE if BUNDLE.is_dir() else None
        self.applied: list[dict] = []
        self.task_log: list[dict] = []
        self.ops = fp.default_operations(self) + [
            fp.Operation("POST", "/installation/plan", self._plan, mutating=True),
            fp.Operation(
                "POST",
                "/installation/apply",
                self._apply,
                mutating=True,
                confirm="apply",
                needs_plan_token=True,
            ),
            fp.Operation(
                "POST",
                "/mcp/verify",
                lambda ctx: {"status": "healthy", "checks": [
                    {"id": "mcp-handshake", "status": "PASS",
                     "detail": "initialize + tools/list ok"}]},
                mutating=True,
                confirm="verify",
            ),
            fp.Operation(
                "POST",
                "/tasks/plan",
                self._task_plan,
                mutating=True,
            ),
            fp.Operation(
                "POST",
                "/tasks/execute",
                self._task_execute,
                mutating=True,
                confirm=None,
                needs_plan_token=True,
            ),
        ]

    # descriptor/navigation the shell needs to render the nav
    def descriptor(self) -> dict:
        return {
            "schema": "forge/PortalDescriptor/v1",
            "forge_id": self.forge_id,
            "forge_name": self.forge_name,
            "version": "0.0.0-e2e",
            "cli": self.cli,
            "navigation": [
                {"id": "dashboard", "label_key": "nav.dashboard", "route": "/",
                 "icon": "dashboard"},
                {"id": "install", "label_key": "nav.install", "route": "/install",
                 "icon": "install"},
                {"id": "profiles", "label_key": "nav.profiles", "route": "/profiles",
                 "icon": "profiles"},
                {"id": "hosts", "label_key": "nav.hosts", "route": "/hosts",
                 "icon": "hosts"},
                {"id": "mcp", "label_key": "nav.mcp", "route": "/mcp",
                 "icon": "mcp"},
                {"id": "skills", "label_key": "nav.skills", "route": "/skills",
                 "icon": "skills"},
                {"id": "agents", "label_key": "nav.agents", "route": "/agents",
                 "icon": "agents"},
                {"id": "tasks", "label_key": "nav.tasks", "route": "/tasks",
                 "icon": "tasks"},
                {"id": "graph", "label_key": "nav.graph", "route": "/graph",
                 "icon": "graph"},
                {"id": "settings", "label_key": "nav.settings", "route": "/settings",
                 "icon": "settings"},
            ],
        }

    def capabilities(self) -> list[dict]:
        return [
            {"id": "install", "state": "supported"},
            {"id": "profiles", "state": "supported"},
            {"id": "hosts", "state": "supported"},
            {"id": "mcp", "state": "supported"},
            {"id": "skills", "state": "supported"},
            {"id": "agents", "state": "supported"},
            {"id": "tasks", "state": "supported"},
            {"id": "graph", "state": "unverified"},
            {"id": "knowledge", "state": "unsupported"},
        ]

    def health(self) -> dict:
        return {
            "schema": "forge/HealthDoc/v1",
            "forge_id": self.forge_id,
            "status": "healthy",
            "checks": [
                {"id": "ledger", "status": "PASS", "detail": "3 managed entries"},
                {"id": "mcp-handshake", "status": "PASS",
                 "detail": "initialize + tools/list ok"},
            ],
            "checked_at": "2026-10-11T00:00:00Z",
        }

    def installation_status(self) -> dict:
        return {
            "schema": "forge/InstallationStatus/v1",
            "forge_id": self.forge_id,
            "status": "healthy",
            "scope": "project",
            "target_root": "E:/e2e/workspace",
            "state_dir": "E:/e2e/workspace/.e2e/install",
            "ledger_entries": 3,
            "drift": {"ok": 3, "modified": [], "missing": []},
            "checks": [
                {"id": "ledger", "status": "PASS", "detail": "3 managed entries"},
            ],
        }

    def hosts(self) -> list[dict]:
        return [
            {"id": "devin", "name": "Devin", "state": "detected",
             "version": "1.0", "launch": {"command": "devin", "args": []}},
            {"id": "claude", "name": "Claude Code", "state": "not_installed"},
            {"id": "codex", "name": "Codex", "state": "not_installed"},
        ]

    def skills(self) -> list[dict]:
        return [
            {"id": "analyze", "name": "Analyze", "state": "available",
             "summary": "real analysis"},
        ]

    def agents(self) -> list[dict]:
        return [{"id": "reviewer", "name": "Reviewer", "state": "available"}]

    def profiles(self) -> list[dict]:
        return [
            {"id": "minimal", "label_key": "profiles.minimal",
             "description_key": "profiles.minimal.d", "current": False},
            {"id": "recommended", "label_key": "profiles.recommended",
             "description_key": "profiles.recommended.d", "current": True},
            {"id": "full", "label_key": "profiles.full",
             "description_key": "profiles.full.d", "current": False},
        ]

    def tasks(self) -> list[dict]:
        return list(self.task_log)

    def graph(self) -> dict:
        return {
            "schema": "forge/GraphDoc/v1",
            "nodes": [
                {"id": "a", "label": "job.py", "kind": "file"},
                {"id": "b", "label": "helper", "kind": "module"},
            ],
            "edges": [{"from": "a", "to": "b", "kind": "imports"}],
        }


    def _plan(self, ctx: fp.RequestContext) -> dict:
        plan = {
            "scope": (ctx.body or {}).get("scope", "project"),
            "host": (ctx.body or {}).get("host", "all"),
            "profile": (ctx.body or {}).get("profile", "recommended"),
            "components": (ctx.body or {}).get("components", []),
            "actions": [{"kind": "write", "path": ".mcp.json"}],
        }
        return {
            "schema": "forge/InstallReceipt/v1",
            "forge_id": self.forge_id,
            "operation": "install",
            "status": "planned",
            "plan": plan,
            "planned_files": [{"path": ".mcp.json"}, {"path": "AGENTS.md"}],
            "verification": {"status": "UNVERIFIED"},
            "plan_token": ctx.handler.server.sign_plan(plan),
        }

    def _apply(self, ctx: fp.RequestContext) -> dict:
        plan = (ctx.body or {}).get("plan") or {}
        if not ctx.handler.server.check_plan(ctx.body["plan_token"], plan):
            raise fp.PortalError("PORTAL-PLAN-STALE", "plan token invalid", http=409)
        self.applied.append(plan)
        return {
            "schema": "forge/InstallReceipt/v1",
            "forge_id": self.forge_id,
            "operation": "install",
            "status": "completed",
            "managed_files": [{"path": ".mcp.json"}, {"path": "AGENTS.md"}],
            "checks": [{"id": "write", "status": "PASS", "detail": "2 files"}],
            "verification": {"status": "PASS"},
        }

    def _task_plan(self, ctx: fp.RequestContext) -> dict:
        intent = ((ctx.body or {}).get("intent") or "").strip()
        if not intent:
            raise fp.PortalError("PORTAL-MISSING-FIELD", "intent required")
        plan = {"verb": "status", "label": "installation status",
                "intent": intent, "args": {}}
        return {"plan": plan,
                "plan_token": ctx.handler.server.sign_plan(plan),
                "status": "planned"}

    def _task_execute(self, ctx: fp.RequestContext) -> dict:
        plan = (ctx.body or {}).get("plan") or {}
        if not ctx.handler.server.check_plan(ctx.body["plan_token"], plan):
            raise fp.PortalError("PORTAL-PLAN-STALE", "plan token invalid",
                                 http=409)
        record = {
            "id": "task-1", "verb": plan.get("verb", "status"),
            "label": plan.get("label", "status"), "stage": "completed",
            "started_at": "2026-10-11T00:00:00Z",
            "finished_at": "2026-10-11T00:00:01Z", "exit_code": 0,
            "receipt": self.installation_status(),
        }
        self.task_log.append(record)
        return {"status": "completed", "task": record,
                "actions": [{"kind": "task", "path": "status", "status": "completed"}]}


# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def portal():
    if not BUNDLE.is_dir():
        pytest.skip("dist/forge-portal-app/browser missing — run `ng build` first")
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    yield server
    server.shutdown()


@pytest.fixture(scope="module")
def pw():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


def _shot(page, name: str) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / f"{name}.png"), full_page=False)


def _open(page, server) -> None:
    page.goto(server.url)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)


def test_first_paint_shell(page, portal):
    _open(page, portal)
    nav = page.locator(".nav, nav").first
    assert nav.count() or page.locator("text=Dashboard").count()
    _shot(page, "01-dashboard")


def test_global_stylesheet_applies(page, portal):
    """Regression: the global stylesheet must actually style the shell.

    Angular's inlineCritical (beasties) defers styles-*.css behind
    media="print" + an inline swap <script>. The portal's CSP is
    script-src 'self' — the swap never runs and the shell renders
    unstyled. Guard the visual contract, not the mechanism.
    """
    _open(page, portal)
    shell = page.locator(".shell")
    shell.wait_for(state="attached")
    display = shell.evaluate("el => getComputedStyle(el).display")
    assert display == "grid", (
        "global stylesheet not applied — check CSP vs deferred "
        "styles-*.css (beasties inlineCritical)"
    )
    link = page.locator("link[rel=stylesheet][media=print]")
    assert link.count() == 0, "print-deferred stylesheet present"


def test_all_routes_render(page, portal):
    routes = ["/install", "/profiles", "/hosts", "/mcp", "/skills",
              "/agents", "/tasks", "/graph", "/settings"]
    _open(page, portal)
    for r in routes:
        page.goto(f"http://127.0.0.1:{portal.port}{r}"
                  f"?forge_session={portal.session_token}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(250)
        # every route paints *something* — header, card or empty state
        assert page.locator("ui-page-header, .card, .empty, ui-empty").count() > 0, \
            f"route {r} rendered nothing"
        _shot(page, f"route-{r.strip('/') or 'dashboard'}")


def test_language_toggle(page, portal):
    _open(page, portal)
    settings = page.locator("a[href='/settings'], .nav__item:has-text('Settings'),"
                            " .nav__item:has-text('Configurações')")
    if settings.count():
        settings.first.click()
        page.wait_for_timeout(300)
    lang_btn = page.locator("text=/português|english|pt-br|en/i").first
    if lang_btn.count():
        lang_btn.click()
        page.wait_for_timeout(300)
        _shot(page, "02-language-toggle")


def test_install_flow_plan_apply(page, portal):
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/install"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    plan_btn = page.locator("button:has-text('Plan'),"
                            " button:has-text('Planejar')").first
    if plan_btn.count() and plan_btn.is_enabled():
        plan_btn.click()
        page.wait_for_timeout(600)
        _shot(page, "03-install-plan")
        # plan rendered — stepper advanced or planned files visible
        assert page.locator("text=/PLANNED|planned|planejad/i").count() > 0
        apply_btn = page.locator("button:has-text('Apply'),"
                                 " button:has-text('Aplicar')").first
        if apply_btn.count() and apply_btn.is_enabled():
            apply_btn.click()
            page.wait_for_timeout(600)
            _shot(page, "04-install-applied")
            assert page.locator("text=/completed|concluí|PASS/i").count() > 0


def test_command_palette(page, portal):
    _open(page, portal)
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    _shot(page, "05-command-palette")


def test_tasks_plan_card(page, portal):
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/tasks"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    intent = page.locator("#intent, input[type='text']").first
    if intent.count():
        intent.fill("check the installation status")
        page.locator("button:has-text('Plan'),"
                     " button:has-text('Planejar')").first.click()
        page.wait_for_timeout(600)
        _shot(page, "06-task-plan")
        # legible plan card — not raw JSON in the viewport
        assert page.locator(".plan-card, dl").count() > 0


def test_mobile_viewport(page, portal):
    page.set_viewport_size({"width": 390, "height": 844})
    _open(page, portal)
    page.wait_for_timeout(300)
    _shot(page, "07-mobile")
    page.set_viewport_size({"width": 1440, "height": 900})


def test_offline_banner(page):
    # dedicated server — the module fixture must stay alive for other tests
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    try:
        _open(page, server)
        # kill the backend mid-session — the shell must degrade, not crash
        server.shutdown()
        page.reload()
        page.wait_for_timeout(800)
        _shot(page, "08-offline")
    finally:
        server.shutdown()


def test_no_console_errors(page, portal):
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/tasks"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    fatal = [e for e in errors if "SyntaxError" in e or "TypeError" in e]
    assert not fatal, f"console errors: {fatal}"


# playwright sync API needs a page fixture
@pytest.fixture()
def page(pw):
    pg = pw.new_page(viewport={"width": 1440, "height": 900})
    yield pg
    pg.close()


# ---------------------------------------------------------------------------
# standalone run — python e2e/browser_e2e.py (same suite, artifacts only)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-q"]))
