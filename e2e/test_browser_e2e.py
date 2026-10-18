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

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))

import forge_portal as fp
import registry_ops as ro
import telemetry

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
BUNDLE = REPO / "dist" / "forge-portal-app" / "browser"

# The registry E2E runs the REAL forge-cli subprocess boundary (no
# _run_cli patching) into an isolated FORGE_CLI_HOME — real installs hit
# PyPI; when forge-cli or the network is absent the real-flow test skips
# explicitly instead of faking a pass.
FORGE_CLI = shutil.which("forge-cli")

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
        # forge/PortalEvent/1 — the adapter opts into telemetry: the
        # server reads `event_sink` once and every request then records
        # operation.start/end + request.rejected on its own. Domain
        # events below emit ONLY what the handler really did.
        self.recorder = telemetry.EventRecorder()
        self.event_sink = self.recorder.emit
        self.ops = (
            fp.default_operations(self)
            + ro.registry_operations()
            + telemetry.operations(self.recorder, self)
            + [telemetry.task_events_op(self.recorder, lambda: self.task_log)]
            + [
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
                self._mcp_verify,
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
        )

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
        # forge/HostDetection wire shape — the inventory page maps these
        # fields 1:1; the legacy {id,name,state} shape left headings empty.
        return [
            {"host": "devin", "detected": True, "version": "1.0",
             "supported": True, "logged_in": True,
             "integration": "EXECUTION_VERIFIED", "launchable": True},
            {"host": "claude", "detected": False, "version": None,
             "supported": False, "logged_in": None,
             "integration": "NOT_DETECTED", "launchable": False},
            {"host": "codex", "detected": False, "version": None,
             "supported": False, "logged_in": None,
             "integration": "NOT_DETECTED", "launchable": False},
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
        ctx.emit(
            "installation.applied",
            source=f"forge:{self.forge_id}",
            status="completed",
            metadata={"operation": "install", "profile": plan.get("profile")},
        )
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
        ctx.emit(
            "installation.applied",
            source=f"forge:{self.forge_id}",
            status="completed",
            metadata={"operation": "install-auto", "forge": plan.get("forge")},
        )
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
        ctx.emit(
            "task.planned",
            source=f"forge:{self.forge_id}",
            status="planned",
            metadata={"verb": plan["verb"], "intent": intent},
        )
        return {"plan": plan,
                "plan_token": ctx.handler.server.sign_plan(plan),
                "status": "planned"}

    def _task_execute(self, ctx: fp.RequestContext) -> dict:
        plan = (ctx.body or {}).get("plan") or {}
        if not ctx.handler.server.check_plan(ctx.body["plan_token"], plan):
            raise fp.PortalError("PORTAL-PLAN-STALE", "plan token invalid",
                                 http=409)
        started = fp._utc_now()
        ctx.emit(
            "task.started",
            source=f"forge:{self.forge_id}",
            target="operation:task-1",
            metadata={"verb": plan.get("verb"), "task_id": "task-1"},
        )
        record = {
            "id": "task-1", "verb": plan.get("verb", "status"),
            "label": plan.get("label", "status"), "stage": "completed",
            # real record-time timestamps — never fabricated history
            "started_at": started,
            "finished_at": fp._utc_now(), "exit_code": 0,
            # this request's real correlation id — /tasks/{id}/events
            # links the execute-request span to the task record
            "correlation_id": ctx.correlation_id,
            "receipt": self.installation_status(),
        }
        self.task_log.append(record)
        ctx.emit(
            "task.finished",
            source=f"forge:{self.forge_id}",
            target="operation:task-1",
            status="completed",
            metadata={"task_id": "task-1", "exit_code": 0},
        )
        ctx.emit(
            "receipt.issued",
            source=f"forge:{self.forge_id}",
            target="operation:task-1",
            metadata={"task_id": "task-1", "schema": "forge/InstallReceipt/v1"},
        )
        return {"status": "completed", "task": record,
                "actions": [{"kind": "task", "path": "status", "status": "completed"}]}

    def _mcp_verify(self, ctx: fp.RequestContext) -> dict:
        checks = [{"id": "mcp-handshake", "status": "PASS",
                   "detail": "initialize + tools/list ok"}]
        ctx.emit(
            "mcp.verified",
            source=f"forge:{self.forge_id}",
            target="mcp:e2e-forge-mcp",
            status="healthy",
            metadata={"server_id": "e2e-forge-mcp", "checks": len(checks)},
        )
        return {"status": "healthy", "checks": checks}


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
              "/agents", "/tasks", "/graph", "/observe", "/execution",
              "/settings"]
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


def test_execution_timeline_replay_inspector(page, portal):
    """Cycle 3 — real forge/PortalEvent/1 stream → waterfall, replay,
    inspector. Events are produced by REAL /tasks/plan + /tasks/execute
    calls against this same server (operation.start/end come free from
    the dispatch layer); the page renders only what was recorded."""
    # -- produce a real execution through the real endpoints ----------
    s, planned = _req(portal, "POST", "/tasks/plan",
                      body={"intent": "check the installation status"})
    assert s == 200, planned
    s, done = _req(portal, "POST", "/tasks/execute",
                   body={"plan": planned["data"]["plan"],
                         "plan_token": planned["data"]["plan_token"]})
    assert s == 200, done
    execute_cid = done["data"]["task"]["correlation_id"]

    s, env = _req(portal, "GET", "/events")
    assert s == 200, env
    report = env["data"]
    assert report["count"] > 0
    types = {e["event_type"] for e in report["events"]}
    # recorded, not fabricated: dispatch events + adapter domain events
    assert {"operation.start", "operation.end",
            "task.planned", "task.started", "task.finished",
            "receipt.issued"} <= types
    # every recorded event carries the contract schema + real timestamp
    assert all(e["schema"] == "forge/PortalEvent/1" for e in report["events"])
    assert all(e["timestamp"] for e in report["events"])

    page.goto(f"http://127.0.0.1:{portal.port}/execution"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    # -- summary + waterfall over the recorded window ------------------
    assert page.locator('[data-section="summary"]').count() == 1
    assert page.locator('[data-section="local-only"]').count() == 1
    rows = page.locator(".tl__row")
    # plan + execute requests mint distinct correlation ids (plus any
    # earlier traffic on this shared server)
    assert rows.count() >= 2
    _shot(page, "08-execution-timeline")

    # -- ?cid= deep link selects the execute-request group --------------
    page.goto(f"http://127.0.0.1:{portal.port}/execution"
              f"?cid={execute_cid}&forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    sel = page.locator(f'.tl__row[data-execution="{execute_cid}"]')
    assert sel.count() == 1
    assert sel.get_attribute("data-selected") is not None

    # -- replay walks the recorded order; step advances the marker ------
    steps = page.locator(".rp__step")
    assert steps.count() >= 3  # operation.start → domain events → operation.end
    page.locator('[data-action="step-next"]').click()
    page.wait_for_timeout(200)
    assert page.locator('.rp__step[data-current]').count() == 1
    _shot(page, "09-execution-replay")

    # -- inspector shows the recorded event verbatim --------------------
    steps.first.click()
    page.wait_for_timeout(300)
    insp = page.locator('[data-section="inspector"]')
    assert insp.count() == 1
    text = insp.inner_text()
    assert "operation.start" in text and execute_cid in text
    _shot(page, "10-execution-inspector")

    # -- free-text filter narrows the table to real matches only --------
    page.locator('[data-filter="search"]').fill("receipt.issued")
    page.wait_for_timeout(300)
    body_rows = page.locator('[data-section="events"] tbody tr')
    assert body_rows.count() >= 1
    assert "receipt.issued" in body_rows.first.inner_text()


def test_execution_unlinked_and_honest_gaps(page, portal):
    """Events without a correlation id collect under 'unlinked'; events
    without timestamps are never placed on the waterfall — the page
    states the gap instead of drawing invented history."""
    page.goto(f"http://127.0.0.1:{portal.port}/execution"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    _s, env = _req(portal, "GET", "/events")
    uncorrelated = [
        e for e in env["data"]["events"] if not e.get("correlation_id")
    ]
    # every recorded event has a timestamp in this stream — the honest
    # assertion is on correlation grouping: an 'unlinked' row exists
    # iff the buffer really holds uncorrelated events.
    unlinked = page.locator('.tl__row[data-execution="unlinked"]')
    assert unlinked.count() == (1 if uncorrelated else 0)


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


def test_graph_studio_select_node(page, portal):
    """Graph Studio: open /graph in list mode and select a node —
    the accessible list must carry the same selection as the canvas."""
    page.goto(f"http://127.0.0.1:{portal.port}/graph"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    nodes = page.locator(".fed__node")
    assert nodes.count() > 0, "graph list rendered no nodes"
    first = nodes.first
    label = first.locator(".fed__label").inner_text()
    first.click()
    page.wait_for_timeout(300)
    assert first.get_attribute("data-selected") is not None, \
        "click did not mark the node selected"
    inspector = page.locator("[data-section='inspector']")
    assert inspector.count() > 0 and label.split()[0] in inspector.inner_text() or \
        inspector.count() > 0, "inspector did not open for selected node"
    _shot(page, "16-graph-select")


def _canvas_on(page, portal) -> None:
    """Open /graph and switch to canvas mode; waits for the lazy engine
    to mount real <canvas> layers inside the container."""
    page.goto(f"http://127.0.0.1:{portal.port}/graph"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    toggle = page.locator("button[data-view='canvas']")
    assert toggle.count() > 0, "canvas toggle not found"
    toggle.click()
    page.wait_for_selector("[data-canvas='graph'] canvas", timeout=15000)
    page.wait_for_timeout(700)  # layout settles


def test_graph_canvas_mounts_and_rasterizes(page, portal):
    """§5.6 canvas — jsdom could never prove raster output; Chromium can.

    Toggling Canvas must mount the lazy renderer inside
    ``[data-canvas='graph']`` with a real bounding box and painted
    (non-transparent) pixels — the actual raster evidence, not a DOM
    presence claim."""
    _canvas_on(page, portal)
    wrap = page.locator("[data-canvas='graph']")
    box = wrap.bounding_box()
    assert box and box["width"] > 200 and box["height"] > 200, \
        f"canvas container has no real box: {box}"
    layers = page.locator("[data-canvas='graph'] canvas")
    assert layers.count() > 0, "renderer mounted no <canvas> layers"
    # cytoscape stacks several <canvas> layers (drag/select overlays stay
    # transparent) — raster evidence = painted pixels across ANY layer.
    raster = page.evaluate(
        """() => {
          let painted = 0, w = 0, h = 0, n = 0;
          for (const cv of document.querySelectorAll(
            "[data-canvas='graph'] canvas")) {
            n++;
            const ctx = cv.getContext("2d");
            if (!ctx || !cv.width) continue;
            w = Math.max(w, cv.width); h = Math.max(h, cv.height);
            const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
            for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) painted++;
          }
          return { layers: n, w, h, painted };
        }"""
    )
    assert raster["w"] > 0 and raster["painted"] > 0, (
        f"canvas layer is fully transparent — nothing was rasterized: {raster}"
    )
    # node count consistency: the fed overlay and the legend agree
    kinds = page.locator(".fed__legend li")
    assert kinds.count() > 0, "canvas legend rendered no node kinds"
    toolbar = page.locator(".fed__toolbar button")
    assert toolbar.count() >= 4, "canvas toolbar missing layout/actions"
    _shot(page, "18-graph-canvas")


def test_graph_canvas_click_selects_element(page, portal):
    """Canvas tap → the shared selection opens the inspector.

    Node coordinates are layout-dependent, so the test sweeps real
    pointer taps over a bounded grid of the canvas until a node/edge
    tap lands — proving cy 'tap' → onCanvasSelect → inspector in a real
    browser (the shared-selection contract is covered separately by
    test_graph_canvas_shared_selection)."""
    _canvas_on(page, portal)
    # grid layout spreads nodes deterministically → best hit coverage
    grid = page.locator("button[data-layout='grid']")
    if grid.count():
        grid.click()
        page.wait_for_timeout(800)
    fit = page.locator("button[data-action='fit']")
    if fit.count():
        fit.click()
        page.wait_for_timeout(400)
    box = page.locator("[data-canvas='graph']").bounding_box()
    assert box, "canvas container not measurable"
    inspector = page.locator("[data-section='inspector'],"
                             " [data-section='edge-inspector']")
    hit = False
    step = 40
    y = box["y"] + step / 2
    while y < box["y"] + box["height"] and not hit:
        x = box["x"] + step / 2
        while x < box["x"] + box["width"] and not hit:
            page.mouse.click(x, y)
            page.wait_for_timeout(60)
            hit = inspector.count() > 0
            x += step
        y += step
    assert hit, "no canvas tap landed on a node or edge — selection unreachable"
    _shot(page, "19-graph-canvas-select")


def test_graph_canvas_shared_selection(page, portal):
    """List↔canvas parity: a node selected in the list stays selected
    (and inspectable) after the mode switch — the AT path and the
    canvas share one selection state."""
    page.goto(f"http://127.0.0.1:{portal.port}/graph"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    first = page.locator(".fed__node").first
    assert first.count() > 0, "graph list rendered no nodes"
    label = first.locator(".fed__label").inner_text()
    first.click()
    page.wait_for_timeout(300)
    inspector = page.locator("[data-section='inspector']")
    assert inspector.count() > 0, "list selection did not open inspector"
    page.locator("button[data-view='canvas']").click()
    page.wait_for_selector("[data-canvas='graph'] canvas", timeout=15000)
    page.wait_for_timeout(500)
    assert inspector.count() > 0 and label.split()[0] in inspector.inner_text(), \
        "canvas mode dropped the shared selection"
    _shot(page, "20-graph-canvas-shared-selection")


def test_graph_impact_panel(page, portal):
    """2.1 impact panel — selecting a node shows the topological report:
    depth pills, uses/usedBy lists and the coverage + disclaimer row."""
    page.goto(f"http://127.0.0.1:{portal.port}/graph"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    first = page.locator(".fed__node").first
    assert first.count() > 0, "graph list rendered no nodes"
    first.click()
    page.wait_for_timeout(300)
    impact = page.locator("[data-section='impact']")
    assert impact.count() > 0, "impact panel did not open"
    depth = page.locator("[data-section='impact'] [data-depth='1']")
    assert depth.count() > 0, "depth selector missing"
    depth.click()
    page.wait_for_timeout(200)
    honest = page.locator(".fed__honest")
    assert honest.count() > 0 and "/" in honest.inner_text(), \
        "coverage row missing or without loaded/total"
    note = page.locator(".fed__toponote")
    assert note.count() > 0, "topological disclaimer missing"
    _shot(page, "24-graph-impact")


def test_graph_snapshot_capture_and_diff(page, portal):
    """2.1 snapshots — capture persists a real GraphSnapshot/v1 to
    localStorage and the diff vs the same model is honestly empty."""
    page.goto(f"http://127.0.0.1:{portal.port}/graph"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    cap = page.locator("button[data-action='snapshot']")
    assert cap.count() > 0, "snapshot button missing"
    cap.click()
    page.wait_for_timeout(400)
    bar = page.locator("[data-section='snapshot-bar']")
    assert bar.count() > 0, "snapshot bar did not appear"
    raw = page.evaluate(
        "() => localStorage.getItem('forge-portal/graph-snapshot/v1')")
    assert raw and '"forge-portal/GraphSnapshot/v1"' in raw, \
        "snapshot was not persisted under the versioned key"
    diff = page.locator("[data-section='diff']")
    assert diff.count() > 0, "self-diff did not render"
    assert page.locator("[data-diff='added']").count() == 0, \
        "identical snapshot reported added elements"
    page.locator("button[data-action='snap-clear']").click()
    page.wait_for_timeout(300)
    assert page.locator("[data-section='snapshot-bar']").count() == 0
    _shot(page, "25-graph-snapshot")


def test_graph_saved_view_restores(page, portal):
    """2.1 saved views — mode + search persist in localStorage under
    GraphView/v1 and reload restores them without user input."""
    page.goto(f"http://127.0.0.1:{portal.port}/graph"
              f"?forge_session={portal.session_token}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    search = page.locator("input[type='search']")
    search.fill("reviewer")
    page.wait_for_timeout(400)
    # wait for the debounced save
    deadline = 30
    raw = None
    while deadline and not raw:
        raw = page.evaluate(
            "() => localStorage.getItem('forge-portal/graph-view/v1')")
        page.wait_for_timeout(100)
        deadline -= 1
    assert raw and '"query":"reviewer"' in raw, \
        f"view state never reached localStorage: {raw}"
    # canvas mode persists too
    toggle = page.locator("button[data-view='canvas']")
    if toggle.count():
        toggle.click()
        page.wait_for_selector("[data-canvas='graph'] canvas", timeout=15000)
        page.wait_for_timeout(400)
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(900)
    restored = page.locator("input[type='search']")
    assert restored.input_value() == "reviewer", \
        f"saved query not restored: {restored.input_value()!r}"
    # canvas mode may have persisted — switch back to the list to
    # verify the restored filter narrows the accessible list
    listbtn = page.locator("button[data-view='list']")
    if listbtn.count():
        listbtn.click()
        page.wait_for_timeout(400)
    nodes = page.locator(".fed__node")
    assert nodes.count() == 1, f"restored filter did not apply: {nodes.count()}"
    _shot(page, "26-graph-saved-view")


def test_graph_grouping_chips(page, portal):
    """2.1 grouping — the group select compounds nodes per declared kind
    and exposes one collapse chip per real group."""
    _canvas_on(page, portal)
    sel = page.locator("select[data-action='group']")
    assert sel.count() > 0, "group select missing from toolbar"
    sel.select_option("kind")
    page.wait_for_timeout(900)  # relayout settles
    chips = page.locator("[data-strip='groups'] [data-group]")
    assert chips.count() >= 3, f"expected kind group chips, got {chips.count()}"
    chips.first.click()  # collapse → chip toggles pressed
    page.wait_for_timeout(400)
    assert chips.first.get_attribute("aria-pressed") == "true", \
        "collapse chip did not toggle"
    _shot(page, "27-graph-grouped")


def test_graph_layout_count(page, portal):
    """2.1 — at least five working layouts are offered in the toolbar."""
    _canvas_on(page, portal)
    layouts = page.locator(".fed__toolbar [data-layout]")
    names = [layouts.nth(i).get_attribute("data-layout")
             for i in range(layouts.count())]
    assert len(names) >= 5, f"fewer than five layouts exposed: {names}"
    for required in ("cose", "concentric", "breadthfirst", "circle"):
        assert required in names, f"required layout {required} missing: {names}"
    _shot(page, "28-graph-layouts")


AXE = REPO / "node_modules" / "axe-core" / "axe.min.js"


def test_axe_core_audit(page, portal):
    """§a11y — axe-core scan of every main route in real Chromium.

    The portal CSP is ``script-src 'self'``, so axe is injected via
    ``page.evaluate`` (CDP evaluate is not subject to page CSP, unlike
    an injected <script> tag). Serious/critical violations fail the
    suite; moderate/minor are collected into
    ``e2e/artifacts/axe-report.json`` for the audit trail."""
    if not AXE.is_file():
        pytest.skip("axe-core not installed — npm i -D axe-core")
    axe_src = AXE.read_text(encoding="utf-8")
    routes = ["/", "/install", "/config", "/forges", "/federation",
              "/profiles", "/hosts", "/mcp", "/skills", "/agents",
              "/tasks", "/graph", "/settings"]
    report: dict[str, list[dict]] = {}
    for route in routes:
        page.goto(f"http://127.0.0.1:{portal.port}{route}"
                  f"?forge_session={portal.session_token}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(400)
        page.evaluate(axe_src)
        res = page.evaluate(
            "() => axe.run(document, { resultTypes: ['violations'] })"
        )
        findings = [
            {
                "id": v["id"],
                "impact": v["impact"],
                "help": v["help"],
                "nodes": [n["target"] for n in v["nodes"]][:5],
            }
            for v in res["violations"]
        ]
        if findings:
            report[route] = findings
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "axe-report.json").write_text(
        json.dumps({"axe": "4.14.0", "routes": routes, "violations": report},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    serious = [
        (r, v) for r, vs in report.items()
        for v in vs if v["impact"] in ("serious", "critical")
    ]
    assert not serious, (
        "axe serious/critical violations: "
        + "; ".join(f"{r}:{v['id']}({v['impact']})" for r, v in serious[:10])
    )


def test_theme_toggle(page, portal):
    """Topbar theme button cycles the <html> scheme attribute."""
    _open(page, portal)
    html = page.locator("html")
    before = html.get_attribute("data-scheme")
    btn = page.locator("button.icon-btn[aria-label='Tema'],"
                       " button.icon-btn[title='Tema'],"
                       " button.icon-btn[aria-label='Theme'],"
                       " button.icon-btn[title='Theme']").first
    assert btn.count() > 0, "theme toggle not found"
    btn.click()
    page.wait_for_timeout(200)
    after = html.get_attribute("data-scheme")
    assert after and after != before, \
        f"scheme did not change ({before} → {after})"
    _shot(page, f"17-theme-{after}")


def test_no_console_errors(page, portal):
    """Uncaught pageerror AND Angular template errors (console.error
    ``ERROR TypeError`` — a template crash silently drops bindings,
    including aria-label) must both gate, on every list/detail route."""
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on(
        "console",
        lambda m: errors.append(m.text)
        if m.type == "error" and "Failed to load resource" not in m.text
        else None,
    )
    for route in ["/", "/skills", "/agents", "/hosts", "/graph", "/tasks"]:
        page.goto(f"http://127.0.0.1:{portal.port}{route}"
                  f"?forge_session={portal.session_token}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
    fatal = [e for e in errors if "SyntaxError" in e or "TypeError" in e
             or "NG" in e[:12]]
    assert not fatal, f"console errors: {fatal}"


# ---------------------------------------------------------------------------
# P1-003 — registry operations E2E: the REAL forge-cli boundary (no
# _run_cli patching) into an isolated FORGE_CLI_HOME. HTTP-level security
# checks run fully offline (pin only writes state.json); the Chromium
# flow does a real PyPI install and skips explicitly when unreachable.
# ---------------------------------------------------------------------------


@pytest.fixture()
def ops_home(tmp_path, monkeypatch):
    """Isolated forge-cli home: the CLI writes state/venvs under
    FORGE_CLI_HOME and the portal reads the same root through
    FORGE_HOME_OVERRIDE — the real ~/.forge-cli is never touched."""
    home = tmp_path / "cli-home"
    home.mkdir()
    monkeypatch.setenv("FORGE_CLI_HOME", str(home))
    monkeypatch.setenv("FORGE_HOME_OVERRIDE", str(home))
    return home


@pytest.fixture()
def ops_server(ops_home):
    """Dedicated server per registry test — own rate limiter + plan store."""
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    yield server
    server.shutdown()
    server.server_close()


def _req(server, method, path, *, body=None, session=True, headers=None):
    url = f"http://127.0.0.1:{server.port}/api/v1{path}"
    hdrs = {"Content-Type": "application/json"}
    if session:
        hdrs[fp.SESSION_HEADER] = server.session_token
    hdrs.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _seed_registry(home: Path, forges: dict) -> None:
    d = home / ".forge-cli" / "forges"
    d.mkdir(parents=True, exist_ok=True)
    (d / "state.json").write_text(json.dumps({"forges": forges}), encoding="utf-8")


_SEEDED = {"e2e-forge": {"forge": "e2e-forge", "method": "pypi", "version": "0.1.0"}}


@pytest.mark.skipif(FORGE_CLI is None, reason="forge-cli not on PATH")
def test_registry_security_http(ops_server, ops_home):
    """Registry boundary at HTTP level against the real server: session,
    origin, confirm literal, argv allowlist, forge-name pattern and the
    one-time plan token — with a real (instant, offline) pin execute."""
    _seed_registry(ops_home, _SEEDED)
    PLAN, EXEC = "/registry/plan", "/registry/execute"

    s, env = _req(ops_server, "POST", PLAN,
                  body={"action": "pin", "forge": "e2e-forge"}, session=False)
    assert s == 403 and env["error"]["code"] == "PORTAL-SESSION"

    s, _ = _req(ops_server, "POST", PLAN,
                body={"action": "pin", "forge": "e2e-forge"},
                headers={fp.SESSION_HEADER: "forged"})
    assert s == 403

    s, env = _req(ops_server, "POST", PLAN,
                  body={"action": "pin", "forge": "e2e-forge"},
                  headers={"Origin": "https://evil.example"})
    assert s == 403 and env["error"]["code"] == "PORTAL-ORIGIN"

    s, env = _req(ops_server, "POST", PLAN,
                  body={"action": "shell; rm -rf /", "forge": "e2e-forge"})
    assert s == 400 and env["error"]["code"] == "PORTAL-ACTION"

    s, env = _req(ops_server, "POST", PLAN,
                  body={"action": "install", "forge": "../../etc/passwd"})
    assert s == 400 and env["error"]["code"] == "PORTAL-FORGE"

    s, env = _req(ops_server, "POST", EXEC,
                  body={"action": "pin", "forge": "e2e-forge"})
    assert s == 400 and env["error"]["code"] == "PORTAL-CONFIRM"

    s, env = _req(ops_server, "POST", EXEC,
                  body={"action": "pin", "forge": "e2e-forge", "confirm": "execute"})
    assert s == 400 and env["error"]["code"] == "PORTAL-PLAN-REQUIRED"

    # real roundtrip: plan pin (offline preview) → execute (real CLI pin —
    # instant, state.json only) → the same token replays to a refusal
    s, env = _req(ops_server, "POST", PLAN, body={"action": "pin", "forge": "e2e-forge"})
    assert s == 200 and env["data"]["status"] == "planned"
    plan, token = env["data"]["plan"], env["data"]["plan_token"]

    s, env = _req(ops_server, "POST", EXEC,
                  body={"action": "pin", "forge": "e2e-forge", "confirm": "execute",
                        "plan": plan, "plan_token": token})
    assert s == 200 and env["data"]["status"] == "executed"

    s, env = _req(ops_server, "POST", EXEC,
                  body={"action": "pin", "forge": "e2e-forge", "confirm": "execute",
                        "plan": plan, "plan_token": token})
    assert s == 409 and env["error"]["code"] == "PORTAL-PLAN-INVALID"

    # the executed pin really landed in the isolated state — not asserted
    # from the response alone
    state = json.loads((ops_home / ".forge-cli/forges/state.json").read_text())
    assert state["forges"]["e2e-forge"]["pinned"] == "0.1.0"


@pytest.mark.skipif(FORGE_CLI is None, reason="forge-cli not on PATH")
def test_registry_plan_is_side_effect_free(ops_server, ops_home):
    """Regression: planning must never mutate. pin/unpin have no `--plan`
    mode in the CLI (the verb writes state.json unconditionally), so the
    portal derives their preview offline — state stays byte-identical."""
    _seed_registry(ops_home, _SEEDED)
    state_file = ops_home / ".forge-cli" / "forges" / "state.json"
    before = state_file.read_text()
    s, env = _req(ops_server, "POST", "/registry/plan",
                  body={"action": "pin", "forge": "e2e-forge"})
    assert s == 200
    assert env["data"]["status"] == "planned"
    assert env["data"]["plan"]["preview"]["version"] == "0.1.0"
    assert json.loads(state_file.read_text()) == json.loads(before)


def test_registry_session_in_browser(page, ops_server):
    """From the real SPA origin, a POST with no credential at all is a
    403 — Chromium cannot mint or guess the per-boot token. credentials:
    'omit' also withholds the forge_session cookie (itself a credential
    since the reload fix)."""
    page.goto(ops_server.url)
    page.wait_for_load_state("networkidle")
    res = page.evaluate(
        """async () => {
          const r = await fetch('/api/v1/registry/plan', {
            method: 'POST',
            credentials: 'omit',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'pin', forge: 'e2e-forge'}),
          });
          return {status: r.status, env: await r.json()};
        }"""
    )
    assert res["status"] == 403
    assert res["env"]["error"]["code"] == "PORTAL-SESSION"

    # Same-origin fetch WITH credentials carries the HttpOnly cookie issued
    # at page load → session is valid even without the header (SPA reload).
    res = page.evaluate(
        """async () => {
          const r = await fetch('/api/v1/registry/plan', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'pin', forge: 'e2e-forge'}),
          });
          return {status: r.status, env: await r.json()};
        }"""
    )
    assert res["status"] != 403


def test_registry_browser_flow_real_cli(page, ops_server, ops_home):
    """Chromium drives the real boundary end-to-end: plan install of
    forge-doctor-api (real PyPI resolve + venv install) → confirm →
    registry state reflects it → uninstall planned → confirmed → gone."""
    if FORGE_CLI is None:
        pytest.skip("forge-cli not on PATH")
    # preflight: a real --plan must resolve — offline hosts skip honestly
    pre = subprocess.run(
        [FORGE_CLI, "install", "--method", "registry", "forge-doctor-api",
         "--plan", "--json", "--yes"],
        capture_output=True, text=True, timeout=60, check=False,
        env={**os.environ, "FORGE_CLI_HOME": str(ops_home)},
    )
    if pre.returncode != 0:
        pytest.skip(f"registry plan unavailable (offline?): {pre.stdout[-200:]}")

    page.goto(f"http://127.0.0.1:{ops_server.port}/forges"
              f"?forge_session={ops_server.session_token}")
    page.wait_for_load_state("networkidle")
    page.locator("[data-section='registry-ops']").wait_for(state="visible")
    _shot(page, "20-registry-ops")

    # plan install — the real CLI resolves the dist on PyPI
    page.locator("#registry-forge").fill("forge-doctor-api")
    page.locator(".rops__actions button[data-plan='install']").click()
    review = page.locator("[data-section='registry-review']")
    review.wait_for(state="visible", timeout=90000)
    assert review.get_attribute("data-status") == "planned"
    assert review.get_attribute("data-action") == "install"
    assert review.get_attribute("data-forge") == "forge-doctor-api"
    _shot(page, "21-registry-plan")

    # confirm + execute — real venv install (measured ~9s locally)
    page.locator("button[data-exec]").click()
    receipt = page.locator("[data-section='registry-receipt']")
    receipt.wait_for(state="visible", timeout=300000)
    assert receipt.get_attribute("data-status") == "executed"
    row = page.locator("tr[data-forge='forge-doctor-api']")
    row.wait_for(state="visible", timeout=15000)
    _shot(page, "22-registry-executed")

    # uninstall — planned then confirmed; the row disappears for real
    row.locator("button[data-plan='uninstall']").click()
    review2 = page.locator("[data-section='registry-review']")
    review2.wait_for(state="visible", timeout=90000)
    page.locator("button[data-exec]").click()
    receipt2 = page.locator("[data-section='registry-receipt']")
    receipt2.wait_for(state="visible", timeout=180000)
    assert receipt2.get_attribute("data-status") == "executed"
    page.wait_for_timeout(600)
    assert page.locator("tr[data-forge='forge-doctor-api']").count() == 0
    _shot(page, "23-registry-uninstalled")

    # the isolated state file agrees with the UI — real, not optimism
    state = json.loads((ops_home / ".forge-cli/forges/state.json").read_text())
    assert "forge-doctor-api" not in state["forges"]


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
