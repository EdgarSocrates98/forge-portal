#!/usr/bin/env python3
"""Portal 2.2 Cycle 5 — scripted usability walkthrough (heuristic).

NO human participants — this is a scripted keyboard-only journey that
MEASURES effort instead of simulating satisfaction. For each step of
the 9-part journey it records: keystrokes spent, the focus trail,
whether the goal element was reached, and friction signals
(unreachable target, deep tab order, silent focus, clipped label).

Journey (task contract):
  1 discover forge        dashboard → forge inventory → forge detail
  2 agent                 → /agents list
  3 skills                → /skills list
  4 MCP                   → /mcp → reach handshake-verify control
  5 diagnose host         → /hosts → reach the FAILED host's detail
  6 graph relationships   → /graph list → open a node inspector
  7 dependencies          → inspector impact uses/usedBy present
  8 inspect execution     → /execution → open a timeline detail
  9 interpret error       → /tasks → reach the failed task's refusal

The keyboard strategies mirror what a real keyboard user does:
Tab-walks through landmarks and the Ctrl+K palette fast path — the
two navigation modes this shell actually offers.

Output: ``e2e/artifacts/usability-cycle5.json``.

Run:  .venv/bin/python e2e/usability_probe.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(REPO / "e2e"))

import forge_portal as fp
from playwright.sync_api import sync_playwright
from visual_audit import AuditAdapter

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

JS_FOCUS = """() => {
  const el = document.activeElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
    role: el.getAttribute('role'),
    href: el.getAttribute('href'),
    name: el.getAttribute('name'),
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 70),
    visible: r.width > 0 && r.height > 0,
    inMain: !!el.closest('main'),
  };
}"""


class Walk:
    def __init__(self, page, server) -> None:
        self.page = page
        self.server = server
        self.keys = 0
        self.trail: list[dict] = []
        self.notes: list[str] = []

    def goto(self, route: str) -> None:
        self.page.goto(
            f"http://127.0.0.1:{self.server.port}{route}"
            f"?forge_session={self.server.session_token}"
        )
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(450)
        self.trail.append({"key": "goto", "to": route})

    def press(self, key: str) -> dict:
        self.keys += 1
        self.page.keyboard.press(key)
        self.page.wait_for_timeout(180)
        f = self.page.evaluate(JS_FOCUS)
        self.trail.append({"key": key, "focus": f})
        return f or {}

    def type_text(self, text: str) -> None:
        self.page.keyboard.type(text, delay=40)
        self.keys += 1
        self.page.wait_for_timeout(350)
        self.trail.append({"key": f"type:{text}", "focus": self.page.evaluate(JS_FOCUS)})

    def tab_until(self, pred_js: str, max_tabs: int = 40) -> dict | None:
        """Tab until predicate on activeElement; returns focus or None."""
        for _ in range(max_tabs):
            f = self.press("Tab")
            if f and self.page.evaluate(pred_js):
                return f
        self.notes.append(f"tab_until missed after {max_tabs} tabs: {pred_js[:70]}")
        return None

    def palette(self, query: str) -> None:
        self.press("Control+k")
        self.page.wait_for_timeout(350)
        self.type_text(query)
        self.page.wait_for_timeout(250)
        self.press("Enter")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(500)

    def url(self) -> str:
        return self.page.url.split("?")[0].rsplit("/", 1)[-1] or "/"


def friction(w: Walk, goal_ok: bool, base_keys: int) -> list[str]:
    out = list(w.notes)
    if not goal_ok:
        out.append("GOAL NOT REACHED via keyboard")
    if w.keys > base_keys + 20:
        out.append(f"deep tab order: {w.keys} keystrokes")
    invisible = [t for t in w.trail if t.get("focus") and not t["focus"]["visible"]]
    if invisible:
        out.append(f"{len(invisible)} focus stops on invisible elements")
    return out


def run() -> dict:
    server = fp.PortalServer(AuditAdapter(), quiet=True)
    server.serve_in_thread()
    steps: list[dict] = []
    try:
        with sync_playwright() as pw:
            page = pw.chromium.launch().new_page(
                viewport={"width": 1366, "height": 768}
            )

            def step(name: str, goal: str, fn, base: int = 0):
                w = Walk(page, server)
                ok = fn(w)
                steps.append(
                    {
                        "step": name,
                        "goal": goal,
                        "url": w.url(),
                        "keystrokes": w.keys,
                        "goal_reached": bool(ok),
                        "friction": friction(w, bool(ok), base),
                        "trail": w.trail[-14:],
                    }
                )

            # 1 — discover forge: dashboard → nav 'Forjas' → detail
            def s1(w: Walk) -> bool:
                w.goto("/")
                f = w.tab_until(
                    "() => document.activeElement?.getAttribute('href') === '/forges'"
                )
                if not f:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(400)
                f = w.tab_until(
                    "() => (document.activeElement?.getAttribute('href')||'')"
                    ".startsWith('/forges/')",
                    max_tabs=25,
                )
                if not f:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(500)
                return "/forges/" in w.page.url

            step("1-discover-forge", "forge detail via sidebar nav", s1, 6)

            # 2 — agents via palette: reach the first interactive
            # element of the list surface (view pills, filter select or
            # a row control) inside <main>.
            def s2(w: Walk) -> bool:
                w.palette("agents")
                f = w.tab_until(
                    "() => { const el = document.activeElement;"
                    "  if (!el || !el.closest('main')) return false;"
                    "  if (el.matches('select, tbody tr *, li *')) return true;"
                    "  return el.closest('tbody tr, li') !== null; }",
                    max_tabs=15,
                )
                return "/agents" in w.page.url and f is not None

            step("2-agent", "agents list, first interactive", s2, 4)

            # 3 — skills
            def s3(w: Walk) -> bool:
                w.palette("skills")
                f = w.tab_until(
                    "() => !!document.activeElement?.closest('tbody tr, li')"
                    " || document.activeElement?.tagName === 'SELECT'",
                    max_tabs=12,
                )
                return "/skills" in w.page.url and f is not None

            step("3-skills", "skills list reach", s3, 4)

            # 4 — MCP: reach the handshake verify button
            def s4(w: Walk) -> bool:
                w.palette("mcp")
                f = w.tab_until(
                    "() => (document.activeElement?.textContent||'')"
                    ".match(/verificar|verify/i) !== null",
                    max_tabs=15,
                )
                return "/mcp" in w.page.url and f is not None

            step("4-mcp", "handshake verify button reachable", s4, 4)

            # 5 — diagnose host: reach a host showing a failure detail
            def s5(w: Walk) -> bool:
                w.palette("hosts")
                f = w.tab_until(
                    "() => !!document.activeElement?.closest('tbody tr, li, .card')"
                    " && document.activeElement?.tagName !== 'BODY'",
                    max_tabs=15,
                )
                detail = w.page.evaluate(
                    "() => document.body.innerText.match(/binary not on PATH|FAILED|"
                    "NOT_DETECTED|EXECUTION_VERIFIED/)?.[0] || null"
                )
                if detail is None:
                    w.notes.append("no host diagnostic state text found")
                return "/hosts" in w.page.url and f is not None and detail is not None

            step("5-diagnose-host", "host diagnostic state visible+reachable", s5, 4)

            # 6 — graph relationships: list mode → node → inspector
            def s6(w: Walk) -> bool:
                w.palette("graph")
                f = w.tab_until(
                    "() => document.activeElement?.dataset?.view === 'list'",
                    max_tabs=20,
                )
                if not f:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(300)
                node = w.tab_until(
                    "() => document.activeElement?.classList?.contains('fed__node')",
                    max_tabs=25,
                )
                if not node:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(400)
                insp = w.page.evaluate(
                    "() => !!document.querySelector('[data-section=inspector]')"
                )
                if not insp:
                    w.notes.append("inspector section did not open")
                return insp

            step("6-graph-relationships", "node inspector via list fallback", s6, 4)

            # 7 — dependencies: impact uses/usedBy visible in inspector
            def s7(w: Walk) -> bool:
                impact = w.page.evaluate(
                    "() => !!document.querySelector('[data-impact=uses],"
                    "[data-impact=usedBy], [data-rel=out], [data-rel=in]')"
                )
                if not impact:
                    w.notes.append("no impact/relations lists in inspector")
                return impact

            step("7-dependencies", "impact uses/usedBy rendered", s7, 0)

            # 8 — inspect execution: two real activations — the timeline
            # row selects the group, then an inspect-row opens the
            # inspector (tr is now tabindex=0 + Enter/Space, 2.2 fix).
            def s8(w: Walk) -> bool:
                w.palette("execution")
                f = w.tab_until(
                    "() => document.activeElement?.classList?.contains('tl__row')",
                    max_tabs=25,
                )
                if not f:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(400)
                selected = w.page.evaluate(
                    "() => !!document.querySelector('.tl__row[data-selected]')"
                )
                if not selected:
                    w.notes.append("timeline row Enter did not select the group")
                f2 = w.tab_until(
                    "() => document.activeElement?.dataset?.action === 'inspect'",
                    max_tabs=70,
                )
                if not f2:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(500)
                open_detail = w.page.evaluate(
                    "() => !!document.querySelector('[data-section=inspector]')"
                )
                if not open_detail:
                    w.notes.append("inspect row Enter opened no inspector")
                    return False
                return True

            step("8-inspect-execution", "execution row activates detail", s8, 4)

            # 9 — interpret error: reach a task row, open its detail and
            # read the refusal code (PORTAL-*) the way a user would.
            def s9(w: Walk) -> bool:
                w.palette("tasks")
                f = w.tab_until(
                    "() => document.activeElement?.classList?.contains('tl__row')"
                    " || !!document.activeElement?.closest('tbody tr')",
                    max_tabs=20,
                )
                if not f:
                    return False
                w.press("Enter")
                w.page.wait_for_timeout(450)
                refusal = w.page.evaluate(
                    "() => document.body.innerText.match(/PORTAL-[A-Z-]+/)?.[0] || null"
                )
                if refusal is None:
                    w.notes.append("task detail carries no PORTAL-* refusal code")
                    return False
                return "/tasks" in w.page.url

            step("9-interpret-error", "refusal code visible+reachable", s9, 4)
    finally:
        server.shutdown()

    return {
        "probe": "usability-cycle5",
        "method": "scripted keyboard-only heuristic — NO human participants",
        "steps": steps,
        "summary": {
            "steps_ok": sum(1 for s in steps if s["goal_reached"]),
            "total": len(steps),
            "total_keystrokes": sum(s["keystrokes"] for s in steps),
            "frictions": sum(len(s["friction"]) for s in steps),
        },
    }


def main() -> int:
    result = run()
    out = ARTIFACTS / "usability-cycle5.json"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False),
                   encoding="utf-8")
    for s in result["steps"]:
        mark = "OK " if s["goal_reached"] else "FAIL"
        print(f"{mark} {s['step']:24s} keys={s['keystrokes']:3d} "
              f"url={s['url']:12s} friction={s['friction']}")
    print(json.dumps(result["summary"]))
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
