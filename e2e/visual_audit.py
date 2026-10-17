#!/usr/bin/env python3
"""Portal 2.1 Cycle 1 — real-browser visual audit capture.

Boots ``portal_core.forge_portal.PortalServer`` with the E2E adapter
(same fixture as ``e2e/test_browser_e2e.py``) plus a dense-data variant,
then captures every route in Chromium across the viewport/theme/zoom
matrix required by prompt_evo_portal2.md §4.1:

  viewports : 1920x1080, 1366x768, 768x1024, 390x844
  themes    : dark (all routes), light (key routes)
  zoom      : 200 % on /dashboard
  variants  : ``base`` adapter and ``dense`` (long ids, failed tasks,
              degraded MCP, many rows) to stress overflow/truncation

Screenshots + a JSON metrics report (horizontal overflow, clipped text,
viewport meta) land in ``docs/design/captures/cycle1/``.

Run:  .venv/bin/python e2e/visual_audit.py [--out DIR] [--routes r1,r2]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(REPO / "e2e"))

import forge_portal as fp
from playwright.sync_api import sync_playwright
from test_browser_e2e import E2EAdapter

ROUTES = [
    "/dashboard",
    "/install",
    "/config",
    "/forges",
    "/forges/self",
    "/match",
    "/federation",
    "/profiles",
    "/hosts",
    "/mcp",
    "/skills",
    "/agents",
    "/tasks",
    "/graph",
    "/observe",
    "/lab",
    "/versions",
    "/knowledge",
    "/settings",
]

VIEWPORTS = [
    ("w1920", 1920, 1080),
    ("d1366", 1366, 768),
    ("t768", 768, 1024),
    ("m390", 390, 844),
]

# §4.1 exige dark+light por rota — o conjunto completo é capturado nos dois
LIGHT_ROUTES = set(ROUTES)


class AuditAdapter(E2EAdapter):
    """Dense-data variant — same wire shapes, heavier payloads to stress
    truncation/overflow: long ids, many rows, a failed task and a
    degraded MCP server so alerts and diagnostics actually render."""

    def skills(self) -> list[dict]:
        return [
            {"id": "analyze", "name": "Analyze", "domain": "core",
             "state": "available", "hosts": ["devin", "claude"],
             "description": "real analysis",
             "summary": "real analysis"},
            {"id": "spark-performance-tuning-advanced-diagnostics",
             "name": "Spark performance tuning — advanced diagnostics",
             "domain": "performance", "state": "available",
             "hosts": ["devin"],
             "description": "Long-name skill exercising table truncation and "
                            "wrapping in narrow viewports"},
            {"id": "graph-export", "name": "Graph export",
             "domain": "graph", "state": "unverified",
             "hosts": [], "description": ""},
        ]

    def agents(self) -> list[dict]:
        return [
            {"id": "reviewer", "name": "Reviewer", "role": "code review",
             "description": "reviews changes", "authority": None,
             "domains": ["code"], "skills": ["Analyze"],
             "hosts": ["devin"], "state": "available"},
            {"id": "glue-incremental-performance-architect",
             "name": "Glue incremental performance architect",
             "role": "orchestrator",
             "description": "proves incremental runs still perform global work",
             "authority": "coordinator",
             "domains": ["performance", "glue"],
             "skills": ["Spark performance tuning — advanced diagnostics",
                        "Analyze"],
             "hosts": ["devin", "claude"], "state": "available"},
        ]

    def hosts(self) -> list[dict]:
        return [
            {"host": "devin", "detected": True, "version": "1.0",
             "supported": True, "logged_in": True,
             "integration": "EXECUTION_VERIFIED", "launchable": True},
            {"host": "claude", "detected": True, "version": "2.1",
             "supported": True, "logged_in": False,
             "integration": "TOOLS_DISCOVERED", "launchable": True},
            {"host": "codex", "detected": False, "version": None,
             "supported": False, "logged_in": None,
             "integration": "FAILED", "launchable": False,
             "detail": "binary not on PATH"},
        ]

    def _mcp_servers(self) -> list[dict]:
        return [
            {"id": "e2e-forge-mcp", "state": "TOOLS_DISCOVERED",
             "host": "devin", "tools_count": 4,
             "last_verify": "2026-10-11T00:00:00Z"},
            {"id": "e2e-forge-mcp-secondary-with-a-very-long-server-identifier",
             "state": "DEGRADED", "host": "claude", "tools_count": None,
             "last_verify": None,
             "detail": "handshake timeout after 5s — second retry scheduled",
             "limitations": ["tools list unavailable"]},
        ]

    def tasks(self) -> list[dict]:
        base = super().tasks()
        return base + [
            {"id": "task-fail", "verb": "verify", "label": "mcp handshake verify",
             "stage": "failed", "started_at": "2026-10-11T00:02:00Z",
             "finished_at": "2026-10-11T00:02:05Z", "exit_code": 2,
             "refusal": "PORTAL-TIMEOUT"},
            {"id": "task-running-long-label-for-timeline-overflow-check",
             "verb": "status",
             "label": "installation status refresh with a deliberately "
                      "long label to probe timeline truncation",
             "stage": "running", "started_at": "2026-10-11T00:03:00Z",
             "finished_at": None, "exit_code": None},
        ]

    def _federation(self) -> dict:
        snap = super()._federation()
        snap["specialists"].append(
            {"provider": "api-forge", "state": "NOT_INSTALLED",
             "cli": "apiforge", "checkout": None, "mcp": None})
        snap["specialists"].append(
            {"provider": "spark-forge-aws", "state": "FAILED",
             "cli": "sparkforge-aws", "checkout": None, "mcp": None,
             "checks": [{"id": "cli", "status": "FAIL",
                         "detail": "cli exited 127"}]})
        snap["summary"] = {"catalog": 3, "installed": 1,
                           "with_mcp": 1, "with_checkout": 1}
        return snap

    def health(self) -> dict:
        h = super().health()
        h["checks"].append({"id": "mcp-secondary", "status": "FAIL",
                            "detail": "handshake timeout after 5s"})
        h["state"] = "DEGRADED"
        return h


JS_METRICS = """() => {
  const doc = document.documentElement;
  const vw = window.innerWidth;
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && !el.closest('.fed__canvas')) {
      const cls = (el.className && el.className.baseVal !== undefined
        ? el.className.baseVal : el.className) || '';
      overflowing.push(
        `${el.tagName.toLowerCase()}.${String(cls).split(' ')[0]} ` +
        `right=${Math.round(r.right)}`);
      if (overflowing.length > 24) break;
    }
  }
  const clipped = [];
  for (const el of document.querySelectorAll(
    'td, dd, h1, h2, h3, .nav__label, .stat__value, code, a, span')) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const style = getComputedStyle(el);
      if (style.overflow === 'hidden' || style.textOverflow === 'ellipsis') {
        clipped.push(el.tagName.toLowerCase() + ' "' +
          (el.textContent || '').trim().slice(0, 48) + '"');
        if (clipped.length > 24) break;
      }
    }
  }
  return {
    scrollW: doc.scrollWidth,
    innerW: vw,
    overflowX: doc.scrollWidth - vw,
    overflowing,
    clipped,
  };
}"""


def route_name(route: str) -> str:
    return route.strip("/").replace("/", "_") or "dashboard"


def capture(page, server, out: Path, routes: list[str], variant: str) -> list[dict]:
    report: list[dict] = []
    base = f"http://127.0.0.1:{server.port}"
    token = server.session_token

    def visit(route: str, tag: str) -> None:
        page.goto(f"{base}{route}?forge_session={token}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(450)
        metrics = page.evaluate(JS_METRICS)
        metrics.update({"route": route, "tag": tag, "variant": variant})
        report.append(metrics)
        page.screenshot(path=str(out / f"{variant}__{tag}__{route_name(route)}.png"))

    # -- dark theme, four viewports, every route -------------------------
    for tag, w, h in VIEWPORTS:
        page.set_viewport_size({"width": w, "height": h})
        for route in routes:
            visit(route, tag)

    # -- light theme, key routes only ------------------------------------
    page.set_viewport_size({"width": 1366, "height": 768})
    page.evaluate("localStorage.setItem('forge-portal.scheme','light')")
    for route in routes:
        if route in LIGHT_ROUTES:
            visit(route, "light1366")
    page.evaluate("localStorage.setItem('forge-portal.scheme','dark')")

    # -- zoom 200 % / 400 % on the dashboard (CSS zoom reflows) -----------
    for zoom, tag in (("2", "zoom200-1366"), ("4", "zoom400-1366")):
        page.evaluate(f"document.documentElement.style.zoom = '{zoom}'")
        visit("/dashboard", tag)
    page.evaluate("document.documentElement.style.zoom = '1'")
    page.set_viewport_size({"width": 1366, "height": 768})
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "docs" / "design" / "captures" / "cycle1"))
    ap.add_argument("--routes", default=",".join(ROUTES))
    ap.add_argument("--variant", default="both", choices=["base", "dense", "both"])
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    routes = [r.strip() for r in args.routes.split(",") if r.strip()]

    report: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1366, "height": 768})
        variants = {"base": E2EAdapter, "dense": AuditAdapter}
        for name, cls in variants.items():
            if args.variant != "both" and args.variant != name:
                continue
            server = fp.PortalServer(cls(), quiet=True)
            server.serve_in_thread()
            try:
                report.extend(capture(page, server, out, routes, name))
            finally:
                server.shutdown()
        browser.close()

    (out / "audit-metrics.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    bad = [r for r in report if r["overflowX"] > 1]
    clipped = [r for r in report if r["clipped"]]
    print(f"captures: {len(report)} -> {out}")
    print(f"horizontal overflow: {len(bad)}")
    for r in bad:
        print(f"  {r['variant']} {r['tag']} {r['route']}: +{r['overflowX']}px "
              f"{r['overflowing'][:4]}")
    print(f"pages with clipped/ellipsized text: {len(clipped)}")
    for r in clipped:
        print(f"  {r['variant']} {r['tag']} {r['route']}: {r['clipped'][:3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
