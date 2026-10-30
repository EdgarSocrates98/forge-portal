#!/usr/bin/env python3
"""Portal 2.2 Cycle 4 — execution/observability rendering audit probe.

Extends ``e2e/perf_probe.py``'s method (real Chromium + CDP against the
production ``dist/`` bundle served by the real ``PortalServer``) with
**event-scale scenarios** per prompt §7.5: 50 / 500 / 1 000 / 5 000 /
10 000 recorded events.

Scale is synthetic on purpose: a probe-only ``ScaleAdapter`` builds an
``EventRecorder(maxlen=N)`` — the production ``DEFAULT_CAPACITY`` (500)
is **not** touched. The scenario exists to measure rendering headroom,
not to raise the real retention limit.

Per route / scenario the probe records:

- ``nav``        : Navigation Timing (fcp, domContentLoaded, load)
- ``cdp``        : JSHeapUsedSize, Nodes, JSEventListeners, LayoutCount,
                   RecalcStyleCount, ScriptDuration, TaskDuration
- ``delta``      : counter deltas attributed to this navigation
- ``dom``        : element count, max tree depth, elements per recorded
                   event, per-section element counts
- ``interact``   : wall-clock + engine deltas for filter typing,
                   execution select, inspector open, replay step
- ``leak``       : Nodes / JSEventListeners / heap after repeated
                   /dashboard <-> /execution navigations (3 cycles)
- ``endpoints``  : real HTTP latency + bytes for /events, /metrics

Run:  .venv/bin/python e2e/exec_render_probe.py [--out FILE]
              [--events 50,500,1000,5000,10000] [--quick]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(REPO / "e2e"))

import forge_portal as fp
import registry_ops as ro
import telemetry
from playwright.sync_api import sync_playwright
from test_browser_e2e import E2EAdapter

ROUTES = ["/observe", "/execution", "/tasks", "/lab"]

CDP_KEYS = (
    "JSHeapUsedSize", "JSHeapTotalSize", "JSEventListeners", "Nodes",
    "LayoutCount", "RecalcStyleCount", "LayoutDuration",
    "RecalcStyleDuration", "ScriptDuration", "TaskDuration",
)

DOM_AUDIT = """() => {
  const els = document.querySelectorAll('*');
  const depth = (n) => {
    let m = 0;
    for (const c of n.children) m = Math.max(m, depth(c) + 1);
    return m;
  };
  const section = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.querySelectorAll('*').length : 0;
  };
  return {
    elements: els.length,
    max_depth: depth(document.documentElement),
    sec_timeline: section('[data-section="timeline"]'),
    sec_events: section('[data-section="events"]'),
    sec_replay: section('[data-section="replay"]'),
    sec_inspector: section('[data-section="inspector"]'),
    table_rows: document.querySelectorAll('tbody tr').length,
    tl_rows: document.querySelectorAll('.tl__row').length,
    tl_ticks: document.querySelectorAll('.tl__tick').length,
    // Cycle 4: ticks are drawn as a CSS gradient — the real placed-tick
    // count lives on [data-ticks], never in the DOM.
    tl_ticks_data: [...document.querySelectorAll('[data-ticks]')]
      .reduce((s, el) => s + Number(el.dataset.ticks || 0), 0),
    tl_spans: document.querySelectorAll('.tl__span').length,
    rp_steps: document.querySelectorAll('.rp__step').length,
    replay_steps: document.querySelectorAll('.rp__step, .replay__step').length,
    pager_navs: document.querySelectorAll('ui-pager .pager').length,
  };
}"""


# ---------------------------------------------------------------------------
# synthetic scale adapter — probe only; production limits untouched
# ---------------------------------------------------------------------------

_EVENT_TYPES = (
    "operation.start", "operation.end", "task.planned", "task.started",
    "task.finished", "receipt.issued", "stage.checkpoint", "span.open",
    "span.close", "hook.run",
)
_STATUSES = ("ok", "completed", "started", "failed", "skipped")


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def synth_events(n: int) -> list[dict]:
    """Deterministic forge/PortalEvent/1 stream: ~8 events per
    correlation group, every 3rd placed event carrying a real
    duration/span pair, every 13th timestamp-less (unplaced), every
    17th uncorrelated — the shapes the renderer must handle."""
    base = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)
    groups = max(1, n // 8)
    out = []
    for i in range(n):
        ev = {
            "schema": telemetry.EVENT_SCHEMA,
            "event_type": _EVENT_TYPES[i % len(_EVENT_TYPES)],
            "status": _STATUSES[i % len(_STATUSES)],
            "source": f"forge:scale-{i % 4}",
            "target": f"operation:op-{i % 9}",
            "metadata": {"detail": f"synthetic event {i}", "idx": i},
        }
        if i % 17 != 0:
            ev["correlation_id"] = f"corr-{i % groups:05d}"
        if i % 13 != 0:
            ev["timestamp"] = _iso(base + timedelta(milliseconds=50 * i))
        if i % 3 == 0:
            ev["duration_ms"] = 20 + (i % 140)
            ev["span_id"] = f"span-{i:06d}"
        if i % 5 == 0:
            ev["parent_span_id"] = f"span-{max(0, i - 3):06d}"
        out.append(ev)
    return out


def synth_tasks(n: int, base_events: int) -> list[dict]:
    """TaskExecution-shaped records, correlation-linked to the same
    synthetic stream — the tasks page replay path stays real."""
    base = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)
    stages = ("completed", "completed", "completed", "failed", "running")
    return [
        {
            "id": f"task-{i:05d}",
            "verb": ("status", "install", "verify")[i % 3],
            "label": f"synthetic task {i}",
            "stage": stages[i % len(stages)],
            "started_at": _iso(base + timedelta(seconds=2 * i)),
            "finished_at": _iso(base + timedelta(seconds=2 * i, milliseconds=900)),
            "exit_code": 0 if stages[i % len(stages)] == "completed" else 1,
            "correlation_id": f"corr-{(i * base_events // max(1, n)) % max(1, base_events // 8):05d}",
        }
        for i in range(n)
    ]


def synth_lab(rows: int) -> dict:
    """LabData-shaped payload: one run file whose per-forge results
    reach `rows` scenario rows — bounded, deterministic."""
    per_forge = max(1, min(50, rows // 4))
    forges = []
    for f in range(4):
        results = [
            {
                "scenario_id": f"sc-{f}-{i:03d}",
                "verdict": ("pass", "pass", "fail", "skipped")[i % 4],
                "duration_ms": 5 + i,
                "metrics": {
                    "duration_ms": {"state": "measured", "value": 5 + i, "unit": "ms"},
                },
                "detail": f"synthetic scenario {i}",
            }
            for i in range(per_forge)
        ]
        forges.append({"forge": f"forge-{f}", "results": results})
    return {
        "dir": "out/lab",
        "runs": [{"file": "run-synth.jsonl", "forges": forges}],
        "reports": [],
        "notes": [],
    }


class ScaleAdapter(E2EAdapter):
    """E2E adapter with a probe-sized event recorder and synthetic
    tasks/lab payloads. Exists only for rendering-scale measurement —
    ``telemetry.DEFAULT_CAPACITY`` is never changed in production code.
    """

    def __init__(self, events: int, tasks: int = 0, lab_rows: int = 0) -> None:
        super().__init__()
        self.recorder = telemetry.EventRecorder(maxlen=max(events, 1))
        self.event_sink = self.recorder.emit
        self._lab = synth_lab(lab_rows) if lab_rows else {"dir": None, "runs": [], "reports": [], "notes": []}
        for ev in synth_events(events):
            self.recorder.emit(ev)
        self.task_log.extend(synth_tasks(tasks, events))
        # rebuild ops — telemetry.operations bound the stock recorder
        self.ops = (
            fp.default_operations(self)
            + ro.registry_operations()
            + telemetry.operations(self.recorder, self)
            + [telemetry.task_events_op(self.recorder, lambda: self.task_log)]
            + [
                fp.Operation("POST", "/installation/plan", self._plan, mutating=True),
                fp.Operation(
                    "POST", "/installation/apply", self._apply,
                    mutating=True, confirm="apply", needs_plan_token=True,
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
                    "POST", "/federation/install-auto", self._federation_apply,
                    mutating=True, confirm="install", needs_plan_token=True,
                ),
                fp.Operation("POST", "/mcp/verify", self._mcp_verify,
                             mutating=True, confirm="verify"),
                fp.Operation("POST", "/tasks/plan", self._task_plan, mutating=True),
                fp.Operation("POST", "/tasks/execute", self._task_execute,
                             mutating=True, confirm=None, needs_plan_token=True),
                fp.Operation("GET", "/lab", lambda ctx: self._lab),
            ]
        )


# ---------------------------------------------------------------------------
# measurement helpers (same method as perf_probe.py)
# ---------------------------------------------------------------------------


def cdp_metrics(cdp) -> dict[str, float]:
    out = cdp.send("Performance.getMetrics")
    got = {m["name"]: m["value"] for m in out["metrics"]}
    return {k: got.get(k) for k in CDP_KEYS}


CUMULATIVE = ("ScriptDuration", "TaskDuration", "LayoutDuration", "RecalcStyleDuration")
COUNTERS = ("LayoutCount", "RecalcStyleCount")


def delta(before: dict, after: dict) -> dict:
    out = {}
    for k in CUMULATIVE:
        if before.get(k) is not None and after.get(k) is not None:
            out[f"{k}_ms"] = round((after[k] - before[k]) * 1000, 1)
    for k in COUNTERS:
        if before.get(k) is not None and after.get(k) is not None:
            out[k] = int(after[k] - before[k])
    return out


def http_get_ms(server: fp.PortalServer, path: str) -> tuple[float, int]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{server.port}/api/v1{path}",
        headers={fp.SESSION_HEADER: server.session_token},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    return (time.perf_counter() - t0) * 1000, len(data)


def measure_scenario(page, cdp, base: str, tok: str, n_events: int) -> dict:
    scen: dict = {"routes": {}, "leak": {}}

    for route in ROUTES:
        b = cdp_metrics(cdp)
        t0 = time.perf_counter()
        page.goto(f"{base}{route}?forge_session={tok}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(350)
        wall = (time.perf_counter() - t0) * 1000
        dom = page.evaluate(DOM_AUDIT)
        a = cdp_metrics(cdp)
        dom["elements_per_event"] = (
            round(dom["elements"] / n_events, 1) if n_events else None
        )
        scen["routes"][route] = {
            "wall_ms": round(wall, 1),
            "cdp": a,
            "delta": delta(b, a),
            "dom": dom,
        }

    # -- interactions on /execution ------------------------------------
    page.goto(f"{base}/execution?forge_session={tok}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(350)
    interact = {}

    def bracket(name, action, settle_ms=300):
        b = cdp_metrics(cdp)
        t0 = time.perf_counter()
        action()
        page.wait_for_timeout(settle_ms)
        wall = (time.perf_counter() - t0) * 1000
        a = cdp_metrics(cdp)
        interact[name] = {"wall_ms": round(wall, 1), **delta(b, a)}

    def type_filter():
        page.locator('[data-filter="search"]').fill("receipt")

    bracket("exec-filter-search", type_filter)

    def select_exec():
        row = page.locator(".tl__row").first
        if row.count():
            row.click()

    bracket("exec-select-execution", select_exec)

    def open_inspector():
        tr = page.locator('[data-section="events"] tbody tr').first
        if tr.count():
            tr.click()

    bracket("exec-open-inspector", open_inspector)

    def replay_step():
        btn = page.locator('[data-action="step-next"]')
        if btn.count() and btn.is_enabled():
            btn.click()

    bracket("exec-replay-step", replay_step)

    # -- interaction on /observe: correlation filter --------------------
    page.goto(f"{base}/observe?forge_session={tok}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(350)

    def type_corr():
        page.locator('[data-filter="correlation"]').fill("corr-00001")

    bracket("observe-filter-corr", type_corr)

    scen["interact"] = interact

    # -- leak: IN-APP route changes — the Angular router destroys and
    #    recreates the page component, so Nodes/JSEventListeners must
    #    stay flat across cycles (a page.goto full reload would measure
    #    renderer retention, not component teardown). The session token
    #    lives in memory + SameSite cookie, so nav clicks stay
    #    authenticated. HeapProfiler.collectGarbage between cycles
    #    separates a true retained leak from ordinary GC lag. --------
    page.goto(f"{base}/execution?forge_session={tok}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(350)
    nodes_seq, listeners_seq, heap_seq = [], [], []
    for _ in range(3):
        page.click('.nav__item[href="/dashboard"]')
        page.wait_for_timeout(400)
        page.click('.nav__item[href="/execution"]')
        page.wait_for_timeout(500)
        # Forced GC before sampling — without it we measure GC lag, not
        # retention. Chromium always exposes HeapProfiler; let it raise.
        cdp.send("HeapProfiler.enable")
        cdp.send("HeapProfiler.collectGarbage")
        page.wait_for_timeout(200)
        m = cdp_metrics(cdp)
        nodes_seq.append(int(m.get("Nodes") or 0))
        listeners_seq.append(int(m.get("JSEventListeners") or 0))
        heap_seq.append(int(m.get("JSHeapUsedSize") or 0))
    scen["leak"] = {
        "nodes_per_cycle": nodes_seq,
        "listeners_per_cycle": listeners_seq,
        "heap_per_cycle": heap_seq,
        "nodes_growth": nodes_seq[-1] - nodes_seq[0] if len(nodes_seq) > 1 else 0,
        "listeners_growth": listeners_seq[-1] - listeners_seq[0]
        if len(listeners_seq) > 1
        else 0,
        "heap_growth_bytes": heap_seq[-1] - heap_seq[0] if len(heap_seq) > 1 else 0,
    }
    return scen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "e2e" / "artifacts" / "exec-render-cycle4.json"))
    ap.add_argument("--events", default="50,500,1000,5000,10000")
    ap.add_argument("--quick", action="store_true", help="only 50 + 500")
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sizes = [50, 500] if args.quick else [int(x) for x in args.events.split(",")]

    result: dict = {"meta": {}, "scenarios": {}}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for n in sizes:
            adapter = ScaleAdapter(
                events=n,
                tasks=min(250, n // 4),
                lab_rows=min(400, n // 5),
            )
            server = fp.PortalServer(adapter, quiet=True)
            server.serve_in_thread()
            base = f"http://127.0.0.1:{server.port}"
            tok = server.session_token
            try:
                # real endpoint cost at this scale (§7.6)
                ev_ms, ev_bytes = http_get_ms(server, "/events")
                mt_ms, mt_bytes = http_get_ms(server, "/metrics")
                evf_ms, _ = http_get_ms(server, "/events?type=operation.end")
                evl_ms, _ = http_get_ms(server, "/events?limit=25")

                page = browser.new_page(viewport={"width": 1366, "height": 768})
                cdp = page.context.new_cdp_session(page)
                cdp.send("Performance.enable")
                scen = measure_scenario(page, cdp, base, tok, n)
                scen["endpoints"] = {
                    "events_ms": round(ev_ms, 1),
                    "events_bytes": ev_bytes,
                    "events_filtered_ms": round(evf_ms, 1),
                    "events_limit25_ms": round(evl_ms, 1),
                    "metrics_ms": round(mt_ms, 1),
                    "metrics_bytes": mt_bytes,
                }
                result["scenarios"][str(n)] = scen
                page.close()

                ex = scen["routes"].get("/execution", {})
                d = ex.get("dom", {})
                print(
                    f"events={n:6d} exec: elems={d.get('elements')} "
                    f"depth={d.get('max_depth')} rows={d.get('table_rows')} "
                    f"nodes={ex.get('cdp', {}).get('Nodes')} "
                    f"heap={round((ex.get('cdp', {}).get('JSHeapUsedSize') or 0) / 1048576, 1)}MB "
                    f"taskΔ={ex.get('delta', {}).get('TaskDuration_ms')}ms "
                    f"http.events={ev_ms:.0f}ms/{ev_bytes}B "
                    f"leak.nodesΔ={scen['leak']['nodes_growth']} "
                    f"leak.listenersΔ={scen['leak']['listeners_growth']}"
                )
            finally:
                server.shutdown()
                server.server_close()
        browser.close()

    result["meta"] = {
        "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tool": "e2e/exec_render_probe.py",
        "chromium": "playwright 1.60 bundled",
        "scenarios": sizes,
        "note": "synthetic event streams via probe-only ScaleAdapter; "
        "production telemetry.DEFAULT_CAPACITY (500) untouched",
    }
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
