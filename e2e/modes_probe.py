#!/usr/bin/env python3
"""Portal 2.2 Cycle 5 — display-modes runtime probe.

Static CSS assertions live in ``src/styles/tokens.spec.ts``; this probe
verifies the SAME contracts at runtime in real Chromium by emulating
the user-agent signals and measuring computed values:

  scheme        ``color_scheme`` emulation × the app's ``system`` pref
                → ``data-scheme`` on <html> + measured --fg-bg/--fg-text
  high contrast ``contrast='more'`` → --fg-focus-width must become 3px
                and borders strengthen (tokens.css @media block)
  reduced motion ``reduced_motion='reduce'`` → every --fg-motion-*
                computes to 0ms AND a real transition-duration resolves
                to 0s on a live control; ``data-motion='full'`` pref
                must restore motion (explicit user override wins)

Output: ``e2e/artifacts/modes-cycle5.json`` + screenshots
``e2e/artifacts/mode-*.png``.

Run:  .venv/bin/python e2e/modes_probe.py
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
from test_browser_e2e import E2EAdapter

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

JS_TOKENS = """(names) => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of names) out[n] = cs.getPropertyValue(n).trim();
  return {
    scheme: document.documentElement.dataset.scheme || null,
    motion: document.documentElement.dataset.motion || null,
    tokens: out,
  };
}"""

JS_TRANSITION = """() => {
  // first element that actually declares a transition in normal mode —
  // .nav links are instant by design and prove nothing either way.
  for (const sel of ['.icon-btn', '.btn', '.fg-pill', '.nav__item', '.card']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.transitionDuration !== '0s' || cs.transitionProperty !== 'all') {
      return { duration: cs.transitionDuration, prop: cs.transitionProperty,
               sel };
    }
  }
  return null;
}"""

TOKEN_NAMES = [
    "--fg-bg", "--fg-text", "--fg-border", "--fg-text-dim",
    "--fg-focus-width", "--fg-motion-fast", "--fg-motion-med",
]


def measure(page, server, tag, *, scheme_pref=None, motion_pref=None,
            color_scheme=None, reduced_motion=None, contrast=None) -> dict:
    page.emulate_media(
        color_scheme=color_scheme,
        reduced_motion=reduced_motion,
        contrast=contrast,
    )
    page.goto(
        f"http://127.0.0.1:{server.port}/dashboard"
        f"?forge_session={server.session_token}"
    )
    if scheme_pref is not None:
        page.evaluate(f"localStorage.setItem('forge-portal.scheme','{scheme_pref}')")
        page.reload()
    if motion_pref is not None:
        page.evaluate(
            "const p = JSON.parse("
            "  localStorage.getItem('forge-portal/prefs/v1')||'{}');"
            f"p.motion='{motion_pref}';"
            "localStorage.setItem('forge-portal/prefs/v1',JSON.stringify(p))"
        )
        page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    m = page.evaluate(JS_TOKENS, TOKEN_NAMES)
    m["transition"] = page.evaluate(JS_TRANSITION)
    m["tag"] = tag
    page.screenshot(path=str(ARTIFACTS / f"mode-{tag}.png"))
    return m


def run() -> dict:
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    out = {"probe": "modes-cycle5", "modes": []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1366, "height": 768})
            page = ctx.new_page()
            cases = [
                # scheme resolution under each UA signal
                {"tag": "scheme-system-ua-dark", "scheme_pref": "system",
                 "color_scheme": "dark"},
                {"tag": "scheme-system-ua-light", "scheme_pref": "system",
                 "color_scheme": "light"},
                {"tag": "scheme-forced-dark", "scheme_pref": "dark",
                 "color_scheme": "light"},
                {"tag": "scheme-forced-light", "scheme_pref": "light",
                 "color_scheme": "dark"},
                # high contrast over both schemes
                {"tag": "contrast-more-light", "scheme_pref": "light",
                 "color_scheme": "light", "contrast": "more"},
                {"tag": "contrast-more-dark", "scheme_pref": "dark",
                 "color_scheme": "dark", "contrast": "more"},
                # reduced motion: UA reduce, then explicit 'full' pref
                {"tag": "motion-reduce", "scheme_pref": "dark",
                 "reduced_motion": "reduce"},
                {"tag": "motion-reduce-pref-full", "scheme_pref": "dark",
                 "reduced_motion": "reduce", "motion_pref": "full"},
                {"tag": "motion-pref-reduced-ua-normal",
                 "scheme_pref": "dark", "reduced_motion": "no-preference",
                 "motion_pref": "reduced"},
            ]
            for c in cases:
                out["modes"].append(measure(page, server, **c))
            ctx.close()
            browser.close()
    finally:
        server.shutdown()
    return out


def verdict(m: dict) -> dict:
    t = m["tokens"]

    def num(px: str) -> float:
        try:
            return float(px.rstrip("px") or 0)
        except ValueError:
            return -1.0

    checks: dict[str, bool] = {}
    tag = m["tag"]
    if tag.startswith("scheme-system"):
        want = "dark" if tag.endswith("dark") else "light"
        checks["data-scheme-follows-ua"] = m["scheme"] == want
    if tag.startswith("scheme-forced"):
        want = tag.rsplit("-", 1)[-1]
        checks["data-scheme-forced"] = m["scheme"] == want
    if tag.startswith("contrast-more"):
        checks["focus-width-3px"] = num(t["--fg-focus-width"]) == 3.0
    def instant(d: str) -> bool:
        # Chromium serializes 0.01ms as '1e-05s'
        try:
            v = float(d.rstrip("ms").rstrip("s"))
            return v <= 1e-5 if d.endswith("s") and not d.endswith("ms") else v <= 0.011
        except ValueError:
            return False

    if tag == "motion-reduce":
        checks["motion-tokens-zero"] = (
            t["--fg-motion-fast"] == "0ms" and t["--fg-motion-med"] == "0ms"
        )
        checks["transition-zero"] = (
            m["transition"] is not None
            and instant(m["transition"]["duration"])
        )
    if tag == "motion-reduce-pref-full":
        # the documented opt-out: data-motion='full' restores token
        # values AND the transition must actually run again — a token
        # without the effect would be an empty gesture.
        checks["pref-full-restores-token"] = t["--fg-motion-fast"] != "0ms"
        checks["pref-full-restores-transition"] = (
            m["transition"] is not None
            and not instant(m["transition"]["duration"])
        )
    if tag == "motion-pref-reduced-ua-normal":
        checks["pref-reduced-applies"] = t["--fg-motion-fast"] == "0ms"
    return checks


def main() -> int:
    result = run()
    for m in result["modes"]:
        m["checks"] = verdict(m)
        m["pass"] = all(m["checks"].values()) if m["checks"] else None
    out = ARTIFACTS / "modes-cycle5.json"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False),
                   encoding="utf-8")
    for m in result["modes"]:
        print(f"{m['tag']:34s} scheme={m['scheme']} motion={m['motion']} "
              f"checks={m['checks']}")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
