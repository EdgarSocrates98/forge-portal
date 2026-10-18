#!/usr/bin/env python3
"""Portal 2.1 Cycle 6 — measured performance probe (real Chromium).

Boots ``portal_core.forge_portal.PortalServer`` with the E2E adapter
(same fixture as ``e2e/test_browser_e2e.py``) serving the **production**
``dist/`` bundle, then measures what prompt_evo_portal2.md §9.2 lists —
no estimated numbers:

per route     : first-contentful-paint, DOMContentLoaded, load-complete,
                JS heap, DOM node count, LayoutCount, RecalcStyleCount,
                ScriptDuration, TaskDuration (Chrome DevTools Protocol
                ``Performance.getMetrics`` + Navigation Timing)
interactions  : filter typing on /skills and /agents, command-palette
                open+query, graph list→canvas toggle — each bracketed by
                CDP metric deltas and wall-clock
telemetry     : EventRecorder emit/report timings at capacity and real
                HTTP latency of GET /events + /metrics with a saturated
                500-event buffer
budget drift  : dist/ chunk sizes summed for the initial entry

This is a *probe* (evidence), not a gate — findings land in
``e2e/artifacts/perf-cycle6.json`` and the console summary feeds
``docs/perf/portal-2.1-benchmarks.md``.

Run:  .venv/bin/python e2e/perf_probe.py [--out FILE] [--quick]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(REPO / "e2e"))

import forge_portal as fp
import telemetry
from playwright.sync_api import sync_playwright
from test_browser_e2e import E2EAdapter

ROUTES = [
    "/dashboard", "/install", "/config", "/forges", "/forges/self",
    "/match", "/federation", "/profiles", "/hosts", "/mcp", "/skills",
    "/agents", "/tasks", "/graph", "/observe", "/execution", "/lab",
    "/versions", "/knowledge", "/guide", "/settings",
]

NAV_TIMING = """() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const paint = performance.getEntriesByType('paint') || [];
  const fcp = (paint.find(e => e.name === 'first-contentful-paint') || {}).startTime ?? null;
  return {
    fcp_ms: fcp === null ? null : +fcp.toFixed(1),
    dom_interactive_ms: +(n.domInteractive ?? 0).toFixed(1),
    dom_content_loaded_ms: +(n.domContentLoadedEventEnd ?? 0).toFixed(1),
    load_complete_ms: +(n.loadEventEnd ?? 0).toFixed(1),
    transfer_bytes: n.transferSize ?? null,
    encoded_bytes: n.encodedBodySize ?? null,
    decoded_bytes: n.decodedBodySize ?? null,
  };
}"""

# CDP metric names we keep (Performance domain — real engine counters)
CDP_KEYS = (
    "JSHeapUsedSize", "JSHeapTotalSize", "Documents", "Frames",
    "JSEventListeners", "Nodes", "LayoutCount", "RecalcStyleCount",
    "LayoutDuration", "RecalcStyleDuration", "ScriptDuration",
    "TaskDuration",
)


def cdp_metrics(cdp) -> dict[str, float]:
    out = cdp.send("Performance.getMetrics")
    got = {m["name"]: m["value"] for m in out["metrics"]}
    return {k: got.get(k) for k in CDP_KEYS}


def http_get_ms(server: fp.PortalServer, path: str) -> tuple[float, int]:
    """Real HTTP round-trip over loopback, timed at the client."""
    req = urllib.request.Request(
        f"http://127.0.0.1:{server.port}/api/v1{path}",
        headers={fp.SESSION_HEADER: server.session_token},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    return (time.perf_counter() - t0) * 1000, len(data)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "e2e" / "artifacts" / "perf-cycle6.json"))
    ap.add_argument("--quick", action="store_true", help="subset of routes")
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    routes = ROUTES[:8] if args.quick else ROUTES

    result: dict = {"meta": {}, "routes": {}, "interactions": {}, "telemetry": {}, "budget": {}}

    # -- telemetry bench (in-process + live HTTP, real numbers) ---------
    rec = telemetry.EventRecorder()
    t0 = time.perf_counter()
    for i in range(rec._events.maxlen):
        rec.emit(
            {
                "schema": telemetry.EVENT_SCHEMA,
                "event_type": "bench.emit",
                "timestamp": fp._utc_now(),
                "correlation_id": f"bench-{i}",
                "status": "ok",
                "metadata": {"detail": "x" * 40},
            }
        )
    emit_ms = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    rep = rec.report(forge_id="bench")
    report_ms = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    mrep = rec.metrics_report()
    metrics_ms = (time.perf_counter() - t0) * 1000
    result["telemetry"]["recorder"] = {
        "capacity": rec._events.maxlen,
        "emit_total_ms": round(emit_ms, 2),
        "emit_per_event_us": round(emit_ms * 1000 / rec._events.maxlen, 2),
        "report_ms": round(report_ms, 2),
        "metrics_report_ms": round(metrics_ms, 2),
        "report_bytes": len(json.dumps(rep, ensure_ascii=False)),
        "metrics_bytes": len(json.dumps(mrep, ensure_ascii=False)),
    }

    # -- browser surface -------------------------------------------------
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    base = f"http://127.0.0.1:{server.port}"
    tok = server.session_token
    try:
        # saturate the live recorder to capacity, then time the real ops
        sink = server.adapter.recorder.emit
        for i in range(telemetry.DEFAULT_CAPACITY):
            sink(
                {
                    "schema": telemetry.EVENT_SCHEMA,
                    "event_type": "bench.http",
                    "timestamp": fp._utc_now(),
                    "correlation_id": f"http-{i}",
                    "status": "ok",
                }
            )
        ev_ms, ev_bytes = http_get_ms(server, "/events")
        mt_ms, mt_bytes = http_get_ms(server, "/metrics")
        evl_ms, _ = http_get_ms(server, "/events?limit=25")
        result["telemetry"]["http"] = {
            "buffer_events": telemetry.DEFAULT_CAPACITY,
            "events_ms": round(ev_ms, 1),
            "events_bytes": ev_bytes,
            "events_limit25_ms": round(evl_ms, 1),
            "metrics_ms": round(mt_ms, 1),
            "metrics_bytes": mt_bytes,
        }

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            cdp = page.context.new_cdp_session(page)
            cdp.send("Performance.enable")

            CUMULATIVE = ("ScriptDuration", "TaskDuration", "LayoutDuration",
                          "RecalcStyleDuration")
            COUNTERS = ("LayoutCount", "RecalcStyleCount")

            def delta(before: dict, after: dict) -> dict:
                out = {}
                for k in CUMULATIVE:  # durations: seconds → ms
                    if before.get(k) is not None and after.get(k) is not None:
                        out[f"{k}_ms"] = round((after[k] - before[k]) * 1000, 1)
                for k in COUNTERS:  # plain counters: delta as-is
                    if before.get(k) is not None and after.get(k) is not None:
                        out[k] = int(after[k] - before[k])
                return out

            for route in routes:
                b = cdp_metrics(cdp)  # cumulative counters → per-route delta
                page.goto(f"{base}{route}?forge_session={tok}")
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(350)
                nav = page.evaluate(NAV_TIMING)
                a = cdp_metrics(cdp)
                result["routes"][route] = {
                    "nav": nav,
                    "cdp": a,
                    "delta": delta(b, a),
                }

            # -- interactions -------------------------------------------

            def interact(name, route, action, settle_ms=350):
                page.goto(f"{base}{route}?forge_session={tok}")
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(350)
                b = cdp_metrics(cdp)
                t0 = time.perf_counter()
                action()
                page.wait_for_timeout(settle_ms)
                wall = (time.perf_counter() - t0) * 1000
                a = cdp_metrics(cdp)
                result["interactions"][name] = {
                    "route": route, "wall_ms": round(wall, 1), **delta(b, a)
                }

            def filter_skills():
                page.locator("input.fb__input").fill("analyze")

            interact("filter-skills", "/skills", filter_skills)

            def filter_agents():
                page.locator("input.fb__input").fill("review")

            interact("filter-agents", "/agents", filter_agents)

            def palette():
                page.keyboard.press("Control+k")
                page.locator(".cp, .palette, [role='dialog']").first.wait_for(
                    state="visible", timeout=5000)
                page.keyboard.type("install")

            interact("command-palette", "/dashboard", palette)

            def graph_canvas():
                btn = page.locator("button[data-view='canvas']")
                if btn.count():
                    btn.click()
                    page.wait_for_timeout(400)

            interact("graph-canvas-toggle", "/graph", graph_canvas, settle_ms=600)

            def theme_toggle():
                btn = page.locator(
                    "button.icon-btn[aria-label='Tema'],"
                    " button.icon-btn[title='Tema'],"
                    " button.icon-btn[aria-label='Theme'],"
                    " button.icon-btn[title='Theme']").first
                if btn.count():
                    btn.click()

            interact("theme-toggle", "/dashboard", theme_toggle, settle_ms=500)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    # -- bundle budget (measured from dist, not the build log) ----------
    dist = REPO / "dist" / "forge-portal-app" / "browser"
    if dist.is_dir():
        index = (dist / "index.html").read_text(encoding="utf-8")
        initial = [p for p in dist.iterdir() if p.is_file() and p.name in index]
        lazy = [p for p in dist.rglob("*") if p.is_file() and p not in initial]
        result["budget"] = {
            "initial_files": sorted(p.name for p in initial),
            "initial_raw_bytes": sum(p.stat().st_size for p in initial),
            "lazy_files": len(lazy),
            "lazy_raw_bytes": sum(p.stat().st_size for p in lazy),
            "total_raw_bytes": sum(p.stat().st_size for p in dist.rglob("*") if p.is_file()),
        }

    result["meta"] = {
        "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tool": "e2e/perf_probe.py",
        "chromium": "playwright 1.60 bundled",
        "note": "single-run headless numbers — orders of magnitude, not SLAs",
    }
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    # -- console summary --------------------------------------------------
    print(f"routes measured: {len(result['routes'])}")
    worst = sorted(
        result["routes"].items(),
        key=lambda kv: kv[1]["nav"].get("load_complete_ms") or 0,
        reverse=True,
    )[:6]
    for r, v in worst:
        n, m, d = v["nav"], v["cdp"], v["delta"]
        print(
            f"  {r:15s} load={n.get('load_complete_ms')}ms fcp={n.get('fcp_ms')}ms "
            f"heap={round((m.get('JSHeapUsedSize') or 0) / 1048576, 1)}MB "
            f"nodes={m.get('Nodes')} taskΔ={d.get('TaskDuration_ms')}ms"
        )
    for name, v in result["interactions"].items():
        print(
            f"  {name:20s} wall={v['wall_ms']}ms "
            f"taskΔ={v.get('TaskDuration_ms')}ms scriptΔ={v.get('ScriptDuration_ms')}ms"
        )
    t = result["telemetry"]
    print(
        f"  telemetry: emit={t['recorder']['emit_per_event_us']}µs/ev "
        f"report={t['recorder']['report_ms']}ms "
        f"http.events={t['http']['events_ms']}ms ({t['http']['events_bytes']}B)"
    )
    b = result["budget"]
    if b:
        print(
            f"  bundle: initial={b['initial_raw_bytes'] // 1024}KB raw "
            f"({len(b['initial_files'])} files) lazy={b['lazy_raw_bytes'] // 1024}KB "
            f"({b['lazy_files']} files)"
        )
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
