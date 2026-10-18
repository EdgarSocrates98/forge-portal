#!/usr/bin/env python3
"""Portal 2.2 Cycle 5 — zoom & reflow probe (WCAG 2.2 SC 1.4.4 / 1.4.10).

Measures, in real headless Chromium, whether each routed page keeps
content inside the viewport — no page-level horizontal scrollbar,
no clipped text without a title escape hatch.

Matrix (task contract):
  zoom      : 100 %, 200 %, 400 %  (document.documentElement.style.zoom)
  viewports : 1920x1080, 1366x768, 768x1024, 390x844
  routes    : all 21 navigable routes (superset of the 19 required)

The server runs the DENSE adapter (``e2e/visual_audit.AuditAdapter``)
so tables, long ids and failed states stress the reflow paths.

Output: ``e2e/artifacts/reflow-cycle5.json`` — per (zoom, viewport,
route): ``overflowX`` px, overflowing elements, clipped text.

Run:  .venv/bin/python e2e/reflow_probe.py [--out ...] [--routes a,b]
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
from visual_audit import JS_METRICS, ROUTES, AuditAdapter
from visual_probe import JS_CLIP

VIEWPORTS = [
    ("1920x1080", 1920, 1080),
    ("1366x768", 1366, 768),
    ("768x1024", 768, 1024),
    ("390x844", 390, 844),
]

ZOOMS = [
    ("100", "1"),
    ("200", "2"),
    ("400", "4"),
]


def run(routes: list[str]) -> dict:
    report: list[dict] = []
    server = fp.PortalServer(AuditAdapter(), quiet=True)
    server.serve_in_thread()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            base = f"http://127.0.0.1:{server.port}"
            token = server.session_token
            for ztag, zoom in ZOOMS:
                for vtag, w, h in VIEWPORTS:
                    page.set_viewport_size({"width": w, "height": h})
                    page.evaluate(
                        f"document.documentElement.style.zoom = '{zoom}'"
                    )
                    for route in routes:
                        page.goto(f"{base}{route}?forge_session={token}")
                        page.wait_for_load_state("networkidle")
                        page.wait_for_timeout(380)
                        m = page.evaluate(JS_METRICS)
                        # cycle-6 clip rule: a clip is "bad" only when the
                        # element has no title fallback and is not inside
                        # a scrollable container (probe-metrics.json).
                        m["clipDetails"] = page.evaluate(JS_CLIP)
                        m["clipsBad"] = [
                            c for c in m["clipDetails"]
                            if not c["title"] and not c["inScroller"]
                        ]
                        m.update(
                            {"route": route, "zoom": ztag, "viewport": vtag}
                        )
                        report.append(m)
            browser.close()
    finally:
        server.shutdown()
    return {
        "probe": "reflow-cycle5",
        "matrix": {
            "zooms": [z for z, _ in ZOOMS],
            "viewports": [v for v, _, _ in VIEWPORTS],
            "routes": routes,
        },
        "results": report,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out", default=str(REPO / "e2e" / "artifacts" / "reflow-cycle5.json")
    )
    ap.add_argument("--routes", default=",".join(ROUTES))
    args = ap.parse_args()
    routes = [r.strip() for r in args.routes.split(",") if r.strip()]
    result = run(routes)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    bad = [r for r in result["results"] if r["overflowX"] > 1]
    clipped = [r for r in result["results"] if r["clipDetails"]]
    bad_clips = [r for r in result["results"] if r["clipsBad"]]
    print(f"captures: {len(result['results'])} -> {out}")
    print(f"page-level horizontal overflow: {len(bad)}")
    for r in bad[:40]:
        print(
            f"  zoom{r['zoom']} {r['viewport']} {r['route']}: "
            f"+{r['overflowX']}px {r['overflowing'][:3]}"
        )
    print(f"pages with clipped text: {len(clipped)}")
    print(f"BAD clips (no title, outside scroller): {len(bad_clips)}")
    for r in bad_clips[:60]:
        print(
            f"  zoom{r['zoom']} {r['viewport']} {r['route']}: "
            + "; ".join(
                f"{c['tag']}.{c['cls']} \"{c['text'][:36]}\"" for c in r["clipsBad"][:4]
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
