# Portal 2.2 — Cycle 2 federated telemetry matrix

Contract: `forge/PortalEvent/1` (events) + `forge/PortalEventReport/1`
(reports). Producers: vendored `PortalServer.emit_event` →
`adapter.event_sink` → `EventRecorder` ring buffer (bounded, in-process,
local-only — no remote sink, nothing leaves the machine).

`/events` and `/metrics` are exposed only when the forge's adapter opts in
by wiring `event_sink` + `telemetry.operations(recorder, adapter)`. The
wiring below was verified over real HTTP in each repo's test suite
(authenticated `GET /api/v1/health` → `GET /api/v1/events` must surface an
`operation.end` event with `correlation_id`, `status`, `duration_ms`,
`source`, `target`, `timestamp`).

## Coverage

| Forge | `_portal_telemetry.py` vendored | event_sink wired | /events | /metrics | /tasks events | Evidence |
|---|---|---|---|---|---|---|
| the-forge | ✅ | ✅ `portal_adapter.py` | VERIFIED | VERIFIED | VERIFIED | `tests/test_portal.py::test_telemetry_events_and_metrics_over_http`, PR #96 |
| api-forge | ✅ | ✅ `portal_adapter.py` | VERIFIED | VERIFIED | VERIFIED | `tests/test_portal_adapter.py::test_telemetria_events_e_metrics_via_http`, PR #91 |
| spark-forge-aws | ✅ | ✅ `portal_adapter.py` | VERIFIED | VERIFIED | VERIFIED | same test name, PR #180 |
| spark-forge-azure | ✅ | ✅ `portal_adapter.py` | VERIFIED | VERIFIED | VERIFIED | same test name, PR #72 |
| platform-forge | ✅ | ✅ `portal_adapter.py` | VERIFIED | VERIFIED | VERIFIED | `tests/test_portal.py::test_telemetry_*`, PR #66, E2E 2026-10-18 |
| forge-doctor-data | ✅ | ✅ `portal_adapter.py` | VERIFIED | VERIFIED | VERIFIED | `tests/test_portal.py::test_telemetry_*`, PR #58, E2E 2026-10-18 |
| forge-doctor-api | ✅ | ✅ `scripts/_forge_portal.py` (flat) | VERIFIED | VERIFIED | VERIFIED | `tests/test_forge_portal.py::test_telemetry_*`, PR #72, E2E 2026-10-18 |

Cross-forge E2E (`scripts/portal_e2e.py`, 2026-10-18): 7/7 PASS,
`GET /api/v1/events` → `forge/PortalEventReport/1` real, `/metrics` →
§5.4 projection, `/tasks/{id}/events` → honest empty window on all seven
forges over authenticated real HTTP.

## Honest degradation

- Adapter without `event_sink` → every `emit_event` is a no-op; no
  `PORTAL-UNSUPPORTED` is fabricated — `/events` simply isn't mounted
  (older vendored generations) or returns an empty report (new wiring,
  nothing recorded yet).
- Events are recorded at the operation boundary (`operation.end` with
  status/duration) plus transport refusals; domain events come from the
  adapter via `ctx.emit(...)`.
- Buffer is bounded (`DEFAULT_CAPACITY = 500`, deque) — no unbounded
  growth; `truncated` flag in the report says when history was dropped.

## Security posture

Events pass through `security.redact` before leaving `emit_event`
(`_forge_portal.py:1028` — sink failures are swallowed + logged, never
break the request). All telemetry stays in-process; `/events` and
`/metrics` require the same session as every other op.
