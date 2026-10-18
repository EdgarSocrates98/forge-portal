# Execution events — `forge/PortalEvent/1` (Cycle 3)

Status: implemented on `feat/portal-2.1-cycle3`. This document is the
audit-first record of the execution-observability cycle: which events
are genuinely produced, which timestamps actually exist, what the
contract guarantees, and where the honest gaps are.

## 1. Audit — what was real before, what was fabricated

| Surface | Before Cycle 3 | Finding |
| --- | --- | --- |
| `portal_core/forge_portal.py` | No event emission at all | The request boundary (session refusal, dispatch, op timing) produced zero observability data — every "execution timeline" upstream had nothing real to draw. |
| `TaskExecution.started_at/finished_at` | Adapter-supplied, but E2E adapter hard-coded `2026-10-11T00:00:00Z` | Real adapters may send real times; the vendored model carries no guarantee. The E2E fixture now stamps real record-time values. |
| `TaskEvent` / `MetricsEvent` | Types existed, no producer in `portal_core` | `/metrics` responses had no recorded events to project — consumers rendered fabricated-looking streams from nothing. |
| Frontend timeline (tasks page) | Replay over `/metrics` | Now backed by real `forge/PortalEvent/1` records through the `metrics_report` projection when the adapter opts in. |
| Causal chain `Intent→Coordinator→…→Receipt` | Concept only | No producer emitted `parent_span_id`, `trace_id`, or stage events — the conceptual chain is now renderable **only where events carry the ids**, never drawn from imagination. |

## 2. Contract

### `forge/PortalEvent/1`

```jsonc
{
  "schema": "forge/PortalEvent/1",   // required
  "event_type": "operation.end",     // required — free-form string
  "timestamp": "2026-10-18T01:03:18.798Z", // stamped at record time
  "event_id": "evt-42",              // minted by the recorder when absent
  "correlation_id": "4655fdf0d0c0",  // request correlation when known
  "trace_id": null,                  // reserved — NOT produced today
  "span_id": "eef6a3d3f3083795",     // per-request span minted at dispatch
  "parent_span_id": null,            // reserved — NOT produced today
  "source": "portal_core",           // who emitted
  "target": "POST /tasks/execute",   // what it acted on
  "status": "ok",                    // verbatim producer vocabulary
  "duration_ms": 3.42,               // measured when the producer measured
  "metadata": {"mutating": true},    // scalarish whitelist
  "evidence": null                   // optional pointers
}
```

- **Additive by design.** Only `schema` + `event_type` are mandatory;
  every other field is optional. Existing producers keep working —
  nothing here is a breaking change.
- **Timestamps are producer truth.** `PortalServer.emit_event` stamps
  `timestamp` at emit time (`_utc_now`, millisecond ISO-8601 UTC).
  There is no API to emit "for" a past moment, and no consumer may
  back-fill one.
- **Best-effort.** A failing or absent sink never breaks a request:
  `emit_event` swallows/logs sink errors. Events are in-process only —
  nothing leaves the machine.
- **Redaction boundary.** Events pass through `redact()` before the
  sink sees them; secret-shaped keys are masked at the source, not
  filtered downstream.

### `forge/PortalEventReport/1` — `GET /api/v1/events`

```jsonc
{
  "schema": "forge/PortalEventReport/1",
  "generated_at": "…", "forge_id": "…",
  "count": 12, "dropped": 0, "truncated": false,
  "capacity": 500, "counters": {"operation.end.ok": 4, …},
  "events": [ /* recorded window, insertion order */ ]
}
```

- Query filters (server-side, over the recorded window only):
  `?correlation_id=`, `?type=`, `?status=`, `?limit=`.
- `dropped`/`truncated` are honest: a bounded buffer (default 500)
  evicts oldest-first and says so — it never claims full history.

### `GET /api/v1/tasks/{task_id}/events`

Events that really belong to a task record: `metadata.task_id`
matches, or the event shares the task's own `correlation_id`. No
timing inference. Unknown task id → `{task: null, events: []}` —
distinguishable from a 404.

### `GET /api/v1/metrics`

The legacy `MetricsReport` field names (`kind/at/duration_ms/status/
origin/correlation_id/detail`), projected 1:1 from recorded events.
Same buffer, same `truncated` flag — no second truth.

## 3. What the vendored server produces

| Event | When | Fields guaranteed |
| --- | --- | --- |
| `request.rejected` | Refusal before/at dispatch: `PORTAL-SESSION`, `PORTAL-NOT-FOUND`, `PORTAL-ORIGIN`, `PORTAL-CONTENT-TYPE`, `PORTAL-RATE-LIMITED`, `PORTAL-PAYLOAD-TOO-LARGE`, `PORTAL-BAD-JSON`, `PORTAL-CONFIRM`, `PORTAL-PLAN-REQUIRED` | `correlation_id`, `source="portal_core"`, `target=<rel path>`, `status="refused"`, `metadata.code`. `span_id` present only for refusals after the span was minted (session/not-found have none — honest gap). |
| `operation.start` | Immediately before the handler runs | `correlation_id`, `span_id`, `target="METHOD /path"`, `status="started"`, `metadata.mutating` |
| `operation.end` | Handler returned / refused / failed / timed out | `status ∈ {ok, refused, failed, timeout}`, `duration_ms` measured with `perf_counter`, `metadata.code` when the refusal carried one |

**Timeout caveat.** A timed-out handler keeps running on its worker
thread. `operation.end status="timeout"` records that the *client's
wait* ended — it is not proof the work stopped, and the orphan cannot
emit a second `end`.

## 4. What adapters emit (`RequestContext.emit`)

Adapters record domain events under the request's real correlation and
span (`emit` defaults `correlation_id`/`span_id`/`source`; callers may
override, e.g. an execute event referencing its earlier plan request).
The E2E adapter emits, truthfully scoped to what each op did:

`task.planned`, `task.started`, `task.finished`, `receipt.issued`,
`installation.applied`, `mcp.verified` — with `source`/`target` as
`kind:id` entity refs (`forge:e2e-forge`, `operation:task-1`,
`mcp:e2e-forge-mcp`) so the graph can link real entities.

## 5. Frontend — `/execution`

| Section | Real | Derived (labelled) | Never fabricated |
| --- | --- | --- | --- |
| Waterfall | One row per recorded `correlation_id`; ticks at real timestamps | Span underlay = `timestamp − duration_ms` (marked derived); bar = first→last recorded time | Events without timestamps — excluded from the axis, counted in `unplaced` |
| Executions | Grouping by recorded `correlation_id` only | — | Events without one → `unlinked` bucket, never guessed |
| Replay | Recorded order; real inter-event gaps scaled by speed | Gap compression cap (8 s) — `compressed` steps display the real delta | No simulated steps, no forward extrapolation |
| Filters | type/status/correlation/search over recorded fields | — | Filtering narrows; never adds history |
| Inspector | Every recorded field verbatim; `task_id` deep link to `/tasks?task=` | `caused-by` only when `parent_span_id` resolves to a recorded span; `related` = same correlation | Missing ids render `—` |
| Summary | `count/dropped/capacity/truncated` from the report | — | 404/no op → UNVERIFIED capability card, not an empty success |

## 6. Graph / Knowledge integration

- `events` joined `FedSource` (`GET /api/v1/events`) with `loaded /
  unavailable` honesty — the coverage strip counts it like every
  other endpoint.
- `tool` is a new `FedNodeKind` (pentagon, teal) with an entity link
  `tool:* → /execution?q=<label>`.
- `observed` edges are emitted **only** for recorded `kind:id`
  entity refs (`source`/`target`) plus `metadata.task_id →
  operation:{id}`; the event type is kept verbatim as the edge
  detail. Bare labels (`portal_core`, `GET /tasks`) never become
  nodes. Event-only nodes go `unverified` when the events source is
  unavailable.
- The conceptual `Intent→Coordinator→Specialist→Tool→Verification→
  Receipt` chain is **not** drawn unless events carry the entity
  refs — nothing infers roles from names.

## 7. Honest gaps (explicitly NOT produced)

- `trace_id`, `parent_span_id` — single-process, no distributed
  tracing today; the fields exist so future producers can fill them.
- Stage-level spans inside a handler — only emitted when the adapter
  chooses to emit them.
- Historical/back-filled timestamps — impossible by design.
- Events for requests rejected before correlation exists (e.g.
  `PORTAL-HOST`) — never reach the API layer at all.
- SSE per-frame events — `operation.end` records stream success/
  failure only.
- Buffer is per-process, bounded, volatile — restart or eviction ends
  history; `truncated`/`dropped` are the honest signal.

## 8. Evidence

- `tests/test_telemetry.py` — 78 tests (recorder bounds, contract
  floor, HTTP ops, filters, task linkage).
- `e2e/test_browser_e2e.py` — Chromium drives `/execution` against
  real recorded events (timeline, `?cid=` deep link, replay stepping,
  inspector, filters, unlinked bucket); artifacts in
  `e2e/artifacts/08-execution-timeline.png`,
  `09-execution-replay.png`, `10-execution-inspector.png`,
  `route-execution.png`.
