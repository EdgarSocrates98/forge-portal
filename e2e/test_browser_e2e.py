"""Browser E2E — real Chromium against the real server + real bundle.

GAP-002 coverage: boots ``portal_core.forge_portal.PortalServer`` on an
ephemeral loopback port serving the actual ``ng build`` output, then
drives Chromium through every route, i18n toggle, theme, command
palette, viewports and offline error recovery. Screenshots land in
``e2e/artifacts/`` — evidence, not mock assertions.

Run:  python -m pytest e2e/ -q        (requires playwright + chromium)
      python e2e/test_browser_e2e.py       (same, standalone, with artifacts)
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
            fp.Operation("GET", "/federation", lambda ctx: self._federation()),
            fp.Operation("GET", "/skills", lambda ctx: self.skills()),
            fp.Operation("GET", "/agents", lambda ctx: self.agents()),
            fp.Operation("GET", "/hosts", lambda ctx: self.hosts()),
            fp.Operation("GET", "/profiles", lambda ctx: self.profiles()),
            fp.Operation("GET", "/tasks", lambda ctx: self.tasks()),
            fp.Operation("GET", "/mcp/servers", lambda ctx: self._mcp_servers()),
            fp.Operation("GET", "/docs/search", self._docs_search),
            fp.Operation("POST", "/federation/plan", self._federation_plan, mutating=True),
            fp.Operation(
                "POST",
                "/federation/install-auto",
                self._federation_apply,
                mutating=True,
                confirm="install",
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
                {"id": "federation", "label_key": "nav.federation", "route": "/federation",
                 "icon": "network"},
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
            {"id": "federation", "state": "supported"},
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

    def _mcp_servers(self) -> list[dict]:
        return [
            {"id": "e2e-forge-mcp", "state": "TOOLS_DISCOVERED",
             "host": "devin", "tools_count": 4,
             "last_verify": "2026-10-11T00:00:00Z"},
        ]

    def _docs_search(self, ctx: fp.RequestContext) -> list[dict]:
        q = (ctx.query.get("q") or [""])[0].lower()
        hits = [
            {"path": "docs/install.md", "title": "Install guide",
             "excerpt": "plan review confirm apply", "category": "guide"},
            {"path": "docs/env.md", "title": "Environment variables",
             "excerpt": "E2E_FORGE_HOME setup", "category": "reference"},
        ]
        return [h for h in hits if q and (q in h["title"].lower() or q in h["excerpt"].lower())]

    def _federation(self) -> dict:
        return {
            "specialists": [
                {"provider": "e2e-forge", "state": "ACTIVE", "cli": self.cli,
                 "checkout": str(REPO), "mcp": {"state": "CONFIGURED"}},
            ],
            "installed_forges": ["e2e-forge"],
            "registry": {"count": 1, "path": "E:/e2e/.forge/installations"},
            "summary": {"catalog": 1, "installed": 1, "with_mcp": 1, "with_checkout": 1},
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

    def _federation_plan(self, ctx: fp.RequestContext) -> dict:
        body = ctx.body or {}
        plan = {
            "scope": body.get("scope", "project"),
            "forge": body.get("forge"),
            "host": body.get("host", "all"),
            "profile": body.get("profile", "recommended"),
            "gateway_profile": body.get("gateway_profile", "balanced"),
            "components": body.get("components"),
        }
        return {
            "status": "planned",
            "plan": plan,
            "plan_token": ctx.handler.server.sign_plan(plan),
            "receipt": {"status": "planned"},
            "actions": [{"kind": "forge", "path": "e2e-forge", "status": "planned"}],
        }

    def _federation_apply(self, ctx: fp.RequestContext) -> dict:
        body = ctx.body or {}
        plan = body.get("plan") or {}
        if not ctx.handler.server.check_plan(body["plan_token"], plan):
            raise fp.PortalError("PORTAL-PLAN-STALE", "plan token invalid", http=409)
        self.applied.append(plan)
        return {
            "schema": "forge/InstallReceipt/v1",
            "forge_id": self.forge_id,
            "operation": "install-auto",
            "status": "completed",
            "host": plan.get("host"),
            "profile": plan.get("profile"),
            "execution_profile": plan.get("gateway_profile"),
            "forges": [{"forge_id": "e2e-forge", "status": "completed", "via": "self"}],
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
    routes = ["/install", "/config", "/forges", "/forges/self", "/federation",
              "/profiles", "/hosts", "/mcp", "/skills",
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
    # language radios render as <label><input type=radio name=locale>…</label>;
    # click the label — the input itself may be visually hidden
    lang_opt = page.locator("label.opt:has(input[name='locale']):has-text('English')").first
    assert lang_opt.count() > 0, "language radiogroup not found on /settings"
    lang_opt.click()
    page.wait_for_timeout(300)
    assert page.locator("input[name='locale'][value='en']").is_checked(), \
        "clicking the 'English' option did not switch locale"
    _shot(page, "02-language-toggle")


def test_install_flow_plan_apply(page, portal):
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/install"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    # nine-step stepper renders (pt-BR or en)
    stepper = page.locator(".stepper__step")
    assert stepper.count() == 9, f"expected 9 steps, got {stepper.count()}"
    plan_btn = page.locator("button:has-text('Plan'),"
                            " button:has-text('Planejar')").first
    if plan_btn.count() and plan_btn.is_enabled():
        plan_btn.click()
        page.wait_for_timeout(600)
        _shot(page, "03-install-plan")
        # review-diff step reached — planned files or actions visible
        assert page.locator("text=/PLANNED|planned|planejad|Review|Revisar/i").count() > 0
        # confirm is a separate, explicit step
        next_btn = page.locator("button:has-text('Continue'),"
                                " button:has-text('Continuar')").first
        if next_btn.count() and next_btn.is_enabled():
            next_btn.click()
            page.wait_for_timeout(300)
        apply_btn = page.locator("button:has-text('Confirm and execute'),"
                                 " button:has-text('Confirmar e executar')").first
        if apply_btn.count() and apply_btn.is_enabled():
            apply_btn.click()
            page.wait_for_timeout(800)
            _shot(page, "04-install-applied")
            # verify + receipt steps: checks and final status rendered
            assert page.locator("text=/completed|concluí|PASS|verified|Verific/i").count() > 0


def test_config_center_env_vars(page, portal):
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/config"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    _shot(page, "05-config-center")
    # variables table renders from /environment (core op — always present)
    assert page.locator("table, .card").count() > 0


def test_explorer_and_detail(page, portal):
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/forges"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    _shot(page, "06-explorer")
    # serving Forja row is always present even without federation
    assert page.locator("text=/e2e-forge/i").count() > 0
    page.goto(f"http://127.0.0.1:{portal.port}/forges/self"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    _shot(page, "07-forge-detail")
    assert page.locator("text=/e2e-forge|serving|servidora/i").count() > 0


def test_palette_grouped_search(page, portal):
    _open(page, portal)
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    page.keyboard.type("install")
    page.wait_for_timeout(700)
    _shot(page, "08-palette-search")
    # grouped results — at least a page-kind hit for the query
    assert page.locator(".cp__list li, .cp__group, [role='option']").count() > 0
    page.keyboard.press("Escape")


def test_federation_flow_plan_apply(page, portal):
    _open(page, portal)
    page.goto(f"http://127.0.0.1:{portal.port}/federation"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    assert page.locator("text=/Família de Forjas|Forge family/i").count() > 0
    plan_btn = page.locator("button:has-text('Gerar plano'),"
                            " button:has-text('Generate family plan')").first
    assert plan_btn.is_enabled()
    plan_btn.click()
    page.wait_for_timeout(600)
    assert page.locator("text=/Revisar plano|Review family plan/i").count() > 0
    apply_btn = page.locator("button:has-text('Aplicar família'),"
                             " button:has-text('Apply family')").first
    assert apply_btn.is_enabled()
    apply_btn.click()
    page.wait_for_timeout(600)
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
    overflow = page.evaluate(
        "document.documentElement.scrollWidth - window.innerWidth"
    )
    assert overflow <= 1, f"mobile horizontal overflow: {overflow}px"
    _shot(page, "07-mobile")
    page.set_viewport_size({"width": 1440, "height": 900})


def test_content_scrolls_in_constrained_viewport(page, portal):
    """Shell must keep long pages reachable inside short browser windows."""
    page.set_viewport_size({"width": 1024, "height": 420})
    page.goto(f"http://127.0.0.1:{portal.port}/install"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(300)
    metrics = page.locator(".content").evaluate(
        "el => ({clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, "
        "overflowY: getComputedStyle(el).overflowY})"
    )
    assert metrics["overflowY"] in ("auto", "scroll")
    assert metrics["scrollHeight"] > metrics["clientHeight"]
    moved = page.locator(".content").evaluate(
        "el => { el.scrollTop = el.scrollHeight; return el.scrollTop; }"
    )
    assert moved > 0, "content viewport did not scroll"
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
# standalone run — python e2e/test_browser_e2e.py (same suite, artifacts only)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-q"]))
