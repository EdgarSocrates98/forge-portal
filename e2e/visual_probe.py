#!/usr/bin/env python3
"""Portal 2.1 Cycle 1 — second-pass probes (contrast, focus, clipping).

Complements ``e2e/visual_audit.py``: same servers/adapters, but instead
of screenshots it measures what a screenshot can't prove — WCAG
contrast ratios of the token palette in both schemes, clipped text
*without* a title fallback (sr-only and aria-hidden excluded), focus
ring visibility after Tab navigation, sub-24px tap targets, and an
axe-core run per route.

Run:  .venv/bin/python e2e/visual_probe.py [--out DIR]
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
from visual_audit import AuditAdapter

AXE = REPO / "node_modules" / "axe-core" / "axe.min.js"

ROUTES = [
    "/dashboard", "/install", "/config", "/forges", "/forges/self",
    "/match", "/federation", "/profiles", "/hosts", "/mcp", "/skills",
    "/agents", "/tasks", "/graph", "/observe", "/lab", "/versions",
    "/knowledge", "/settings",
]

# srgb "r g b" or hex -> luminance ratio vs a background color
JS_CONTRAST = """(pairs) => {
  function lum([r,g,b]) {
    const c = [r,g,b].map(v => { v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); });
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
  }
  function ratio(fg, bg) { const a=lum(fg),b=lum(bg); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); }
  function parse(s) {
    s = s.trim();
    if (s.startsWith('#')) {
      const h = s.slice(1);
      const n = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
      return [parseInt(n.slice(0,2),16),parseInt(n.slice(2,4),16),parseInt(n.slice(4,6),16)];
    }
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    return m[1].split(/[\\s,\\/]+/).slice(0,3).map(Number);
  }
  const cs = getComputedStyle(document.documentElement);
  const vars = {};
  for (const name of pairs.vars) vars[name] = parse(cs.getPropertyValue(name));
  const out = {};
  for (const [label, [fg,bg]] of Object.entries(pairs.checks)) {
    const f = vars[fg], b = vars[bg];
    out[label] = (f && b) ? +ratio(f,b).toFixed(2) : null;
  }
  return out;
}"""

CONTRAST_CHECK = {
    "vars": ["--fg-text", "--fg-text-2", "--fg-text-dim", "--fg-accent-ink",
             "--fg-info", "--fg-success", "--fg-warning", "--fg-error",
             "--fg-unverified", "--fg-surface", "--fg-surface-2", "--fg-bg",
             "--fg-accent-fill", "--fg-accent-contrast", "--fg-accent-bg",
             "--fg-error-bg", "--fg-warning-bg", "--fg-info-bg",
             "--fg-success-bg", "--fg-unverified-bg"],
    "checks": {
        "text/surface": ["--fg-text", "--fg-surface"],
        "text-2/surface": ["--fg-text-2", "--fg-surface"],
        "text-dim/surface": ["--fg-text-dim", "--fg-surface"],
        "accent-ink/surface": ["--fg-accent-ink", "--fg-surface"],
        "accent-ink/accent-bg": ["--fg-accent-ink", "--fg-accent-bg"],
        "info/surface": ["--fg-info", "--fg-surface"],
        "ok/surface": ["--fg-success", "--fg-surface"],
        "warn/surface": ["--fg-warning", "--fg-surface"],
        "error/surface": ["--fg-error", "--fg-surface"],
        "unverified/surface": ["--fg-unverified", "--fg-surface"],
        "accent-contrast/accent-fill": ["--fg-accent-contrast", "--fg-accent-fill"],
        "warn/warn-bg": ["--fg-warning", "--fg-warning-bg"],
        "error/error-bg": ["--fg-error", "--fg-error-bg"],
        "info/info-bg": ["--fg-info", "--fg-info-bg"],
        "ok/ok-bg": ["--fg-success", "--fg-success-bg"],
        "unverified/unverified-bg": ["--fg-unverified", "--fg-unverified-bg"],
        "accent-ink/bg": ["--fg-accent-ink", "--fg-bg"],
        "text-2/bg": ["--fg-text-2", "--fg-bg"],
        "text-dim/bg": ["--fg-text-dim", "--fg-bg"],
    },
}

JS_CLIP = """() => {
  const out = [];
  for (const el of document.querySelectorAll('td, dd, h1, h2, h3, p, code, a, span, th, dt, li')) {
    if (el.closest('.sr-only') || el.classList.contains('sr-only')) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.closest('.fed__canvas')) continue;
    if (!(el.scrollWidth > el.clientWidth + 2) || !el.clientWidth) continue;
    const st = getComputedStyle(el);
    if (st.overflow === 'visible') continue;      // spills, not clips
    const wrap = el.closest('.table-wrap, .card--table, .content');
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.split(' ')[0] : '',
      text: (el.textContent || '').trim().slice(0, 56),
      title: el.getAttribute('title'),
      inScroller: !!(wrap && wrap.scrollWidth > wrap.clientWidth + 1),
    });
    if (out.length > 40) break;
  }
  return out;
}"""

JS_TARGETS = """() => {
  const bad = [];
  for (const el of document.querySelectorAll(
    'button, a, input, select, [role=button], [role=tab], summary')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.height < 20 || r.width < 20) {
      bad.push(`${el.tagName.toLowerCase()} "${(el.textContent||'').trim().slice(0,32)}" ` +
               `${Math.round(r.width)}x${Math.round(r.height)}`);
      if (bad.length > 30) break;
    }
  }
  return bad;
}"""

JS_FOCUS = """async () => {
  const seen = [];
  const focus = () => document.activeElement;
  for (let i = 0; i < 14; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab'}));
    // real tab moves need the browser — use keyboard via CDP outside
    break;
  }
  return seen;
}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "docs" / "design" / "captures" / "cycle1"))
    ap.add_argument("--variant", default="both", choices=["base", "dense", "both"])
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    axe_src = AXE.read_text(encoding="utf-8") if AXE.is_file() else None

    result: dict = {"contrast": {}, "routes": {}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, cls in {"base": E2EAdapter, "dense": AuditAdapter}.items():
            if args.variant != "both" and args.variant != name:
                continue
            server = fp.PortalServer(cls(), quiet=True)
            server.serve_in_thread()
            try:
                page = browser.new_page(viewport={"width": 1366, "height": 768})
                base = f"http://127.0.0.1:{server.port}"
                tok = server.session_token
                for scheme in ("dark", "light"):
                    page.goto(f"{base}/dashboard?forge_session={tok}")
                    page.wait_for_load_state("networkidle")
                    page.evaluate(
                        f"localStorage.setItem('forge-portal.scheme','{scheme}')")
                    page.reload()
                    page.wait_for_load_state("networkidle")
                    page.wait_for_timeout(300)
                    key = f"{name}-{scheme}"
                    result["contrast"][key] = page.evaluate(
                        JS_CONTRAST, CONTRAST_CHECK)
                page.evaluate("localStorage.setItem('forge-portal.scheme','dark')")
                for route in ROUTES:
                    page.goto(f"{base}{route}?forge_session={tok}")
                    page.wait_for_load_state("networkidle")
                    page.wait_for_timeout(400)
                    entry: dict = {"clipped": page.evaluate(JS_CLIP),
                                   "targets": page.evaluate(JS_TARGETS)}
                    if axe_src:
                        page.evaluate(axe_src)
                        res = page.evaluate(
                            "() => axe.run(document, {resultTypes:['violations']})")
                        entry["axe"] = [
                            {"id": v["id"], "impact": v["impact"],
                             "nodes": [n["target"] for n in v["nodes"]][:4]}
                            for v in res["violations"]]
                    # keyboard probe: 10 real Tabs — collect focused tag +
                    # whether a visible outline/box-shadow is painted
                    focused = []
                    for _ in range(10):
                        page.keyboard.press("Tab")
                        page.wait_for_timeout(60)
                        f = page.evaluate("""() => {
                          const el = document.activeElement;
                          if (!el) return null;
                          const st = getComputedStyle(el);
                          const r = el.getBoundingClientRect();
                          return {tag: el.tagName.toLowerCase(),
                                  cls: String(el.className||'').split(' ')[0],
                                  outline: st.outlineStyle + ' ' + st.outlineWidth,
                                  shadow: st.boxShadow !== 'none',
                                  visible: r.width > 0 && r.height > 0};
                        }""")
                        focused.append(f)
                    entry["focusTrail"] = focused
                    noRing = [f for f in focused if f and f["visible"]
                              and not f["shadow"]
                              and f["outline"] in ("none 0px", "none medium")]
                    entry["focusNoRing"] = noRing
                    result["routes"][f"{name}{route}"] = entry
                page.close()
            finally:
                server.shutdown()
        browser.close()

    (out / "probe-metrics.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result["contrast"], indent=2))
    print("\n-- clipped without title (outside scrollers) --")
    for rk, e in result["routes"].items():
        bad = [c for c in e["clipped"] if not c["title"] and not c["inScroller"]]
        if bad:
            print(f"{rk}: {bad[:5]}")
    print("\n-- sub-target controls --")
    for rk, e in result["routes"].items():
        if e["targets"]:
            print(f"{rk}: {e['targets'][:6]}")
    print("\n-- focus without visible ring --")
    for rk, e in result["routes"].items():
        if e["focusNoRing"]:
            print(f"{rk}: {e['focusNoRing'][:6]}")
    print("\n-- axe serious/critical --")
    for rk, e in result["routes"].items():
        bad = [v for v in e.get("axe", []) if v["impact"] in ("serious", "critical")]
        if bad:
            print(f"{rk}: {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
