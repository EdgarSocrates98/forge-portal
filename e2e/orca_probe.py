#!/usr/bin/env python3
"""Portal 2.2 Cycle 5 — real screen-reader probe (Orca + headed Chromium).

Drives the portal with a REAL assistive technology in the loop:

  1. boots ``portal_core.forge_portal.PortalServer`` with the E2E adapter
     (same fixture as ``e2e/test_browser_e2e.py``);
  2. starts ``orca --debug --debug-file=/tmp/orca-portal.log`` against
     the live session AT-SPI bus (``DISPLAY`` honoured — works under
     Wayland via XWayland, no flags needed in this environment);
  3. launches HEADED Chromium with ``--force-renderer-accessibility``
     so the ATK tree is exported eagerly;
  4. performs keyboard-only journeys — Tab walks, Enter activations,
     Ctrl+K palette searches — and, after each step, diffs the Orca
     debug log for ``SPEECH OUTPUT`` lines and records the focused
     element (``document.activeElement``) as ground truth.

Output: ``e2e/artifacts/orca-cycle5.json`` — distilled announcements
per step plus an attach verdict. If Orca never binds the Chromium
script, every step is marked NOT_TESTED with the raw evidence kept.

Run:  .venv/bin/python e2e/orca_probe.py [--out e2e/artifacts/orca-cycle5.json]

Not a pytest module on purpose: it requires a compositor + Orca +
speech-dispatcher and must never run in headless CI.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(REPO / "e2e"))

import forge_portal as fp
from playwright.sync_api import Error as PwError
from playwright.sync_api import sync_playwright
from test_browser_e2e import E2EAdapter

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
ORCA_LOG = Path("/tmp/orca-portal.log")

SPEECH_RE = re.compile(r"SPEECH OUTPUT: '(.*)' \{")
FRAME_SKIP = re.compile(r"(Prospero|Chromium|Google Chrome)")

# JS: describe the element holding DOM focus — the probe's ground truth
# against which Orca announcements are compared.
JS_FOCUSED = """() => {
  const el = document.activeElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const label = el.closest('label');
  const lb = el.getAttribute('aria-labelledby');
  const labelledByText = lb
    ? lb.split(/\\s+/).map((i) => document.getElementById(i)?.textContent || '')
        .join(' ').trim()
    : null;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    labelledby: labelledByText || lb,
    name: el.getAttribute('name'),
    type: el.getAttribute('type'),
    checked: el.checked ?? null,
    href: el.getAttribute('href'),
    cls: (el.className && el.className.baseVal !== undefined
      ? el.className.baseVal : el.className || '').toString().slice(0, 80),
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
    label: label ? (label.textContent || '').trim().replace(/\\s+/g, ' ')
      .slice(0, 80) : null,
    visible: r.width > 0 && r.height > 0,
    inMain: !!el.closest('main'),
    inNav: !!el.closest('nav'),
    isBody: el === document.body,
  };
}"""


def _speech_lines(path: Path, offset: int) -> tuple[list[str], int]:
    """Return (new SPEECH OUTPUT utterances, new offset)."""
    if not path.is_file():
        return [], offset
    data = path.read_text(encoding="utf-8", errors="replace")
    new = data[offset:]
    out = []
    for line in new.splitlines():
        m = SPEECH_RE.search(line)
        if m:
            out.append(m.group(1))
    # dedupe consecutive repeats — Orca re-speaks on focus re-asserts
    deduped = [u for i, u in enumerate(out) if i == 0 or u != out[i - 1]]
    return deduped, offset + len(new.encode("utf-8"))


def _log_grep(path: Path, needle: str) -> int:
    if not path.is_file():
        return 0
    return path.read_text(encoding="utf-8", errors="replace").count(needle)


class OrcaProbe:
    def __init__(self) -> None:
        self.orca: subprocess.Popen | None = None
        self.offset = 0
        self.steps: list[dict] = []
        self.attach = {
            "orca_binary": shutil.which("orca"),
            "chromium_script_loaded": False,
            "speech_initialized": False,
            "speech_dispatch_lines": 0,
            "not_tested": False,
            "notes": [],
        }

    # -- lifecycle --------------------------------------------------------
    def start_orca(self) -> None:
        ORCA_LOG.unlink(missing_ok=True)
        self.orca = subprocess.Popen(
            ["orca", f"--debug-file={ORCA_LOG}", "--debug"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")},
        )
        # wait until the debug file exists and speech is initialized
        deadline = time.time() + 20
        while time.time() < deadline:
            if ORCA_LOG.is_file() and "SPEECH: Initialized" in ORCA_LOG.read_text(
                encoding="utf-8", errors="replace"
            ):
                break
            if self.orca.poll() is not None:
                self.attach["not_tested"] = True
                self.attach["notes"].append("orca exited during startup")
                return
            time.sleep(0.4)
        self.attach["speech_initialized"] = (
            ORCA_LOG.is_file()
            and "SPEECH: Initialized" in ORCA_LOG.read_text(
                encoding="utf-8", errors="replace"
            )
        )
        # settle past the startup monologue; start diffing from here
        time.sleep(2)
        if ORCA_LOG.is_file():
            self.offset = ORCA_LOG.stat().st_size

    def stop_orca(self) -> None:
        if not self.orca:
            return
        self.orca.send_signal(signal.SIGTERM)
        try:
            self.orca.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.orca.kill()
        self.orca = None

    def finalize_attach(self) -> None:
        hits = _log_grep(ORCA_LOG, "orca.scripts.toolkits.Chromium")
        self.attach["chromium_script_loaded"] = hits > 0
        self.attach["speech_dispatch_lines"] = _log_grep(
            ORCA_LOG, "SPEECH DISPATCHER: Speaking"
        )
        if not self.attach["chromium_script_loaded"]:
            self.attach["not_tested"] = True
            self.attach["notes"].append(
                "Orca never mapped Chromium to its toolkit script — AT-SPI "
                "events from the browser were not received."
            )

    # -- probe primitives -------------------------------------------------
    def record(self, page, step_id: str, action: str, keys: list[str]) -> dict:
        focused = page.evaluate(JS_FOCUSED)
        announcements, self.offset = _speech_lines(ORCA_LOG, self.offset)
        # split portal utterances from other-window chatter (shared
        # desktop): keep the filtered ones as evidence that Orca was
        # alive but presenting a different app — an environment fact,
        # not an app defect.
        portal = [
            a for a in announcements if not FRAME_SKIP.search(a) or "forge" in a.lower()
        ]
        elsewhere = [a for a in announcements if a not in portal]
        step = {
            "id": step_id,
            "action": action,
            "keys": keys,
            "url": page.url.split("?")[0],
            "focused": focused,
            "announcements": portal,
        }
        if elsewhere:
            step["orca_elsewhere"] = elsewhere[:4]
        self.steps.append(step)
        return step

    def key(self, page, step_id: str, keys: list[str], settle_ms: int = 1500) -> dict:
        for k in keys:
            if k.startswith("type:"):
                page.keyboard.type(k[5:], delay=40)
            else:
                page.keyboard.press(k)
            page.wait_for_timeout(250)
        page.wait_for_timeout(settle_ms)
        return self.record(page, step_id, f"keys {'+'.join(keys)}", keys)

    def goto(self, page, server, step_id: str, route: str, settle_ms: int = 2200) -> dict:
        page.goto(
            f"http://127.0.0.1:{server.port}{route}?forge_session={server.session_token}"
        )
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(settle_ms)
        return self.record(page, step_id, f"goto {route}", [])

    def tab_until(
        self, page, step_id: str, predicate_js: str, max_tabs: int = 30
    ) -> dict:
        """Tab forward until focused element matches predicate; Enter it."""
        hits = 0
        for i in range(max_tabs):
            if i and i % 10 == 0:
                # shared desktop: re-raise our window so Orca's locus of
                # focus doesn't stay on another app mid-walk
                try:
                    page.bring_to_front()
                except PwError:
                    pass  # window gone — let the step fail honestly
            page.keyboard.press("Tab")
            page.wait_for_timeout(1400)
            focused = page.evaluate(JS_FOCUSED)
            ann, self.offset = _speech_lines(ORCA_LOG, self.offset)
            portal = [a for a in ann if not FRAME_SKIP.search(a)]
            elsewhere = [a for a in ann if a not in portal]
            st = {
                "id": f"{step_id}-tab{i + 1}",
                "action": "keys Tab",
                "keys": ["Tab"],
                "url": page.url.split("?")[0],
                "focused": focused,
                "announcements": portal,
            }
            if elsewhere:
                st["orca_elsewhere"] = elsewhere[:4]
            self.steps.append(st)
            if focused and page.evaluate(predicate_js):
                hits += 1
                break
        if not hits:
            self.steps.append(
                {
                    "id": f"{step_id}-TARGET-MISSING",
                    "action": f"tab_until {predicate_js[:60]}",
                    "keys": ["Tab"] * max_tabs,
                    "url": page.url.split("?")[0],
                    "focused": page.evaluate(JS_FOCUSED),
                    "announcements": [],
                }
            )
            return self.steps[-1]
        page.keyboard.press("Enter")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2200)
        return self.record(page, f"{step_id}-enter", "keys Enter", ["Enter"])

    def palette(self, page, step_id: str, query: str) -> dict:
        """Ctrl+K → type query → Enter — the keyboard fast path."""
        try:
            page.bring_to_front()
        except PwError:
            pass  # window gone — let the step fail honestly
        page.keyboard.press("Control+k")
        page.wait_for_timeout(1600)
        self.record(page, f"{step_id}-palette-open", "keys Control+k", ["Control+k"])
        page.keyboard.type(query, delay=60)
        page.wait_for_timeout(1600)
        self.record(
            page, f"{step_id}-palette-query", f'type "{query}"', [f"type:{query}"]
        )
        page.keyboard.press("Enter")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2400)
        return self.record(page, f"{step_id}-palette-enter", "keys Enter", ["Enter"])


def run() -> dict:
    probe = OrcaProbe()
    result: dict = {
        "probe": "orca-cycle5",
        "orca_version": subprocess.run(
            ["orca", "--version"], capture_output=True, text=True, check=False
        ).stdout.strip()
        if shutil.which("orca")
        else None,
        "display": os.environ.get("DISPLAY"),
        "session_type": os.environ.get("XDG_SESSION_TYPE"),
        "attach": probe.attach,
        "steps": probe.steps,
        "orca_log": str(ORCA_LOG),
    }
    if not probe.attach["orca_binary"]:
        probe.attach["not_tested"] = True
        probe.attach["notes"].append("orca binary not on PATH")
        return result

    probe.start_orca()
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=False,
                args=["--force-renderer-accessibility", "--start-maximized"],
            )
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            try:
                # Wayland compositor: keep our window raised so Orca keeps
                # presenting it (only the active app's events are spoken).
                page.bring_to_front()
                # 1 — dashboard load; document focus starts on <body> so
                # the first Tab lands on the skip link (DOM order).
                probe.goto(page, server, "dashboard-load", "/")

                # 2 — Tab through the sidebar landmarks (skip link → nav),
                # then Enter the skip link to prove it moves focus to
                # <main id="content">.
                probe.key(page, "sidebar-tab1", ["Tab"])
                step = probe.steps[-1]
                if (step["focused"] or {}).get("cls", "").startswith("skip-link"):
                    probe.key(page, "skip-link-enter", ["Enter"])
                    # blur → sequential focus restarts at the document top
                    page.evaluate(
                        "document.activeElement && document.activeElement.blur()"
                    )
                    page.wait_for_timeout(600)
                    probe.key(page, "sidebar-tab1b", ["Tab"])
                for i in range(10):
                    probe.key(page, f"sidebar-tab{i + 2}", ["Tab"])

                # 3 — Enter a forge: keep Tabbing until the /forges nav
                # link, Enter, then Enter the first forge row link.
                probe.tab_until(
                    page, "nav-forges",
                    "() => document.activeElement?.getAttribute('href') === '/forges'",
                )
                probe.tab_until(
                    page, "forge-row",
                    "() => (document.activeElement?.getAttribute('href') || '')"
                    ".startsWith('/forges/')",
                )

                # 4 — explore routes via the keyboard fast path
                probe.palette(page, "route-agents", "agents")
                for i in range(3):
                    probe.key(page, f"agents-tab{i + 1}", ["Tab"])
                probe.palette(page, "route-skills", "skills")
                for i in range(3):
                    probe.key(page, f"skills-tab{i + 1}", ["Tab"])
                probe.palette(page, "route-mcp", "mcp")
                for i in range(3):
                    probe.key(page, f"mcp-tab{i + 1}", ["Tab"])

                # 5 — graph: enter, then keyboard-activate the LIST
                # fallback (not just the canvas).
                probe.palette(page, "route-graph", "graph")
                probe.tab_until(
                    page, "graph-list",
                    "() => document.activeElement?.dataset?.view === 'list'",
                    max_tabs=18,
                )
                for i in range(4):
                    probe.key(page, f"graph-list-tab{i + 1}", ["Tab"])

                # 6 — tasks + observe
                probe.palette(page, "route-tasks", "tasks")
                for i in range(3):
                    probe.key(page, f"tasks-tab{i + 1}", ["Tab"])
                probe.palette(page, "route-observe", "observe")
                for i in range(3):
                    probe.key(page, f"observe-tab{i + 1}", ["Tab"])

                # 7 — settings: reach the theme radiogroup and toggle
                # dark with Arrow keys (native radio behaviour).
                probe.palette(page, "route-settings", "settings")
                probe.tab_until(
                    page, "settings-scheme",
                    "() => document.activeElement?.name === 'scheme'",
                    max_tabs=30,
                )
                probe.key(page, "settings-scheme-arrow", ["ArrowDown"])
                probe.key(page, "settings-scheme-arrow2", ["ArrowDown"])

                # 8 — Escape / blur sanity: does focus escape the page?
                probe.key(page, "escape-hatch", ["Escape"])
            finally:
                browser.close()
    finally:
        time.sleep(1.5)
        probe.finalize_attach()
        probe.stop_orca()
        server.shutdown()

    speech_total = sum(len(s["announcements"]) for s in probe.steps)
    # silent steps where Orca was provably presenting ANOTHER app are
    # environment interference (shared desktop), not app silence
    silent = [
        s["id"]
        for s in probe.steps
        if not s["announcements"] and "orca_elsewhere" not in s
    ]
    diverted = [s["id"] for s in probe.steps if "orca_elsewhere" in s]
    result["summary"] = {
        "steps": len(probe.steps),
        "steps_with_speech": sum(1 for s in probe.steps if s["announcements"]),
        "speech_utterances": speech_total,
        "silent_steps": silent,
        "steps_where_orca_presented_other_apps": diverted,
        "verdict": (
            "REAL"
            if probe.attach["chromium_script_loaded"] and speech_total > 0
            else "NOT_TESTED"
        ),
    }
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ARTIFACTS / "orca-cycle5.json"))
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    result = run()
    out.write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"attach: {json.dumps(result['attach'], ensure_ascii=False)}")
    print(f"summary: {json.dumps(result.get('summary', {}), ensure_ascii=False)}")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
