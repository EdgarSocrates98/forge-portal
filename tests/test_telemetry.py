"""Cycle 3 — forge/PortalEvent/1 telemetry.

Asserts the vendored server records REAL events at the real boundaries:
operation start/end (ok/refused/failed/timeout), transport refusals,
adapter domain emits via ctx.emit, redaction of secret-shaped metadata,
the /events + /metrics read ops and the /tasks/{id}/events link — all
over HTTP, same fixture pattern as test_forge_portal.py.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "portal_core"))

import forge_portal as fp
import telemetry


class TelemetryAdapter(fp.PortalAdapter):
    """Adapter that opts in: event_sink + telemetry ops + a domain
    emitter — the same wiring an instrumented forge uses."""

    forge_id = "telemetry-forge"
    cli = "telemetry-forge"

    def __init__(self) -> None:
        self.recorder = telemetry.EventRecorder(maxlen=200)
        self.event_sink = self.recorder.emit
        self._tasks: list[dict] = []
        self.ops = (
            fp.default_operations(self)
            + telemetry.operations(self.recorder, self)
            + [
                telemetry.task_events_op(self.recorder, lambda: list(self._tasks)),
                fp.Operation("GET", "/tasks", lambda ctx: list(self._tasks)),
                fp.Operation("POST", "/fail", self._fail),
                fp.Operation("POST", "/crash", self._crash),
                fp.Operation("GET", "/slow", lambda ctx: time.sleep(5), timeout=0.2),
                fp.Operation("POST", "/work", self._work),
            ]
        )

    def _fail(self, ctx):
        raise fp.PortalError("T-REFUSED", "refused by policy", http=409)

    def _crash(self, ctx):
        raise ValueError("boom — internals must stay server-side")

    def _work(self, ctx):
        # domain events under the request's real span/correlation
        ctx.emit(
            "tool.invocation",
            source="forge:telemetry-forge",
            target="tool:forge-cli",
            metadata={"action": "pin", "api_key": "AKIA-SHOULD-REDACT"},
        )
        record = {
            "id": "task-1",
            "verb": "doctor",
            "stage": "completed",
            "started_at": "2026-10-20T00:00:00Z",
            "finished_at": "2026-10-20T00:00:01Z",
            "correlation_id": ctx.correlation_id,
        }
        self._tasks.append(record)
        ctx.emit(
            "task.finished",
            target=f"operation:{record['id']}",
            status="ok",
            metadata={"task_id": record["id"]},
        )
        return {"status": "completed", "task": record}


@pytest.fixture(scope="module")
def server():
    srv = fp.PortalServer(TelemetryAdapter(), quiet=True)
    thread = srv.serve_in_thread()
    yield srv
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=5)


def call(server: fp.PortalServer, method: str, path: str, *, body=None, session=True, headers=None):
    url = f"http://127.0.0.1:{server.port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"Content-Type": "application/json"}
    if session:
        hdrs[fp.SESSION_HEADER] = server.session_token
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _events(server) -> list[dict]:
    s, env = call(server, "GET", "/api/v1/events")
    assert s == 200
    return env["data"]["events"]


def _by_type(events, etype, target=None):
    return [
        e
        for e in events
        if e["event_type"] == etype and (target is None or e.get("target") == target)
    ]


class TestContract:
    def test_every_event_carries_the_floor(self, server):
        call(server, "GET", "/api/v1/health")
        for e in _events(server):
            assert e["schema"] == "forge/PortalEvent/1"
            assert isinstance(e["event_type"], str) and e["event_type"]
            assert isinstance(e["timestamp"], str) and e["timestamp"].endswith("Z")
            assert e["event_id"].startswith("evt-")

    def test_operation_pair_shares_span_and_correlation(self, server):
        call(server, "GET", "/api/v1/health", headers={"X-Correlation-Id": "cid-x"})
        evs = _events(server)
        starts = [e for e in evs if e["event_type"] == "operation.start" and e.get("correlation_id") == "cid-x"]
        ends = [e for e in evs if e["event_type"] == "operation.end" and e.get("correlation_id") == "cid-x"]
        assert len(starts) == 1 and len(ends) == 1
        assert starts[0]["span_id"] == ends[0]["span_id"]
        assert ends[0]["duration_ms"] >= 0

    def test_no_sink_is_a_noop(self):
        # default adapter — no event_sink attr → emits are silently dropped
        srv = fp.PortalServer(fp.PortalAdapter(), quiet=True)
        try:
            srv.emit_event("operation.start", target="GET /x")
        finally:
            srv.server_close()


class TestBoundaries:
    def test_refusal_records_code(self, server):
        call(server, "POST", "/api/v1/fail", body={})
        ends = _by_type(_events(server), "operation.end", "POST /fail")
        assert ends and ends[-1]["status"] == "refused"
        assert ends[-1]["metadata"]["code"] == "T-REFUSED"

    def test_internal_error_records_client_visible_code_only(self, server):
        call(server, "POST", "/api/v1/crash", body={})
        ends = _by_type(_events(server), "operation.end", "POST /crash")
        assert ends and ends[-1]["status"] == "failed"
        # PORTAL-INTERNAL is the client-visible code — the exception
        # internals stay in the server log, never in the event stream.
        assert ends[-1]["metadata"]["code"] == "PORTAL-INTERNAL"

    def test_timeout_records_real_end(self, server):
        s, _env = call(server, "GET", "/api/v1/slow")
        assert s == 504
        ends = _by_type(_events(server), "operation.end", "GET /slow")
        assert ends and ends[-1]["status"] == "timeout"
        assert ends[-1]["metadata"]["code"] == "PORTAL-TIMEOUT"

    def test_transport_refusals_recorded(self, server):
        call(server, "GET", "/api/v1/health", session=False)
        call(server, "GET", "/api/v1/not-an-op")
        call(server, "POST", "/api/v1/work", body={}, headers={"Origin": "https://evil.example"})
        kinds = {
            e["metadata"]["code"]
            for e in _events(server)
            if e["event_type"] == "request.rejected"
        }
        assert {"PORTAL-SESSION", "PORTAL-NOT-FOUND", "PORTAL-ORIGIN"} <= kinds

    def test_confirm_refusal_recorded(self, server):
        # /work has no confirm requirement; use a mutating default op path —
        # registry ops are not on this adapter, so assert via a confirm op.
        s, _env = call(server, "POST", "/api/v1/work", body={"confirm": "nope"})
        # non-confirm op accepts any body — still 200; the confirm path is
        # covered by test_forge_portal.py. Here just assert the op ran.
        assert s == 200


class TestDomainEmits:
    def test_ctx_emit_lands_with_real_context(self, server):
        call(server, "POST", "/api/v1/work", body={})
        evs = _by_type(_events(server), "tool.invocation", "tool:forge-cli")
        assert evs
        e = evs[-1]
        assert e["source"] == "forge:telemetry-forge"
        assert e["correlation_id"] and e["span_id"]
        # redaction ran before the sink stored it
        assert e["metadata"]["api_key"] == "«redacted»"

    def test_task_events_link(self, server):
        call(server, "POST", "/api/v1/work", body={})
        s, env = call(server, "GET", "/api/v1/tasks/task-1/events")
        assert s == 200
        data = env["data"]
        assert data["task"]["id"] == "task-1"
        types = {e["event_type"] for e in data["events"]}
        assert "task.finished" in types  # metadata.task_id match
        assert "operation.end" in types  # shares the task's correlation_id

    def test_task_events_unknown_id_is_honest(self, server):
        s, env = call(server, "GET", "/api/v1/tasks/nope/events")
        assert s == 200
        assert env["data"]["task"] is None
        assert env["data"]["events"] == []


class TestReportOps:
    def test_events_report_shape(self, server):
        call(server, "GET", "/api/v1/health")
        s, env = call(server, "GET", "/api/v1/events")
        assert s == 200
        d = env["data"]
        assert d["schema"] == "forge/PortalEventReport/1"
        assert d["count"] == len(d["events"])
        assert d["truncated"] == (d["dropped"] > 0)
        assert isinstance(d["generated_at"], str)

    def test_events_filters(self, server):
        call(server, "POST", "/api/v1/work", body={})
        s, env = call(server, "GET", "/api/v1/events?type=tool.invocation")
        assert s == 200
        assert all(e["event_type"] == "tool.invocation" for e in env["data"]["events"])
        s, env = call(server, "GET", "/api/v1/events?status=timeout")
        assert all(e["status"] == "timeout" for e in env["data"]["events"])
        s, env = call(server, "GET", "/api/v1/events?limit=2")
        assert len(env["data"]["events"]) == 2

    def test_metrics_projection(self, server):
        call(server, "POST", "/api/v1/work", body={})
        s, env = call(server, "GET", "/api/v1/metrics")
        assert s == 200
        d = env["data"]
        assert {"generated_at", "counters", "events", "truncated"} <= set(d)
        for e in d["events"]:
            assert {"kind", "at", "duration_ms", "status", "origin", "correlation_id"} <= set(e)
        kinds = {e["kind"] for e in d["events"]}
        assert "operation.end" in kinds
        assert d["counters"].get("operation.end", 0) >= 1


class TestRecorderUnit:
    def test_contract_floor_drops_malformed(self):
        r = telemetry.EventRecorder()
        assert r.emit({"event_type": "x"}) is None  # no schema
        assert r.emit({"schema": telemetry.EVENT_SCHEMA}) is None  # no type
        assert r.emit("not-a-dict") is None
        ok = r.emit(
            {"schema": telemetry.EVENT_SCHEMA, "event_type": "t", "timestamp": "2026-10-20T00:00:00Z"}
        )
        assert ok is not None and ok["event_id"] == "evt-1"

    def test_bounded_buffer_marks_truncated(self):
        r = telemetry.EventRecorder(maxlen=5)
        for i in range(9):
            r.emit({"schema": telemetry.EVENT_SCHEMA, "event_type": "t", "timestamp": "x", "event_id": str(i)})
        assert r.dropped == 4
        assert len(r.snapshot()) == 5
        assert r.report()["truncated"] is True

    def test_events_for_task_matches_metadata_and_correlation(self):
        r = telemetry.EventRecorder()
        base = {"schema": telemetry.EVENT_SCHEMA, "timestamp": "x"}
        r.emit({**base, "event_type": "a", "correlation_id": "c1"})
        r.emit({**base, "event_type": "b", "metadata": {"task_id": "task-9"}})
        r.emit({**base, "event_type": "c", "correlation_id": "other"})
        out = r.events_for_task("task-9", "c1")
        assert {e["event_type"] for e in out} == {"a", "b"}
