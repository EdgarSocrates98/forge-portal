"""pytest suite for portal_core/atlas_ops.py — the Code Atlas probe.

A stub HTTP server stands in for `code-atlas api serve` (the real
surface is stdlib http.server on loopback too, so this exercises the
same transport path). Every state — available / degraded / unavailable
— is produced by a REAL answer or a REAL refusal, never by monkeying
with the probe internals.
"""

from __future__ import annotations

import json
import socket
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "portal_core"))

import atlas_ops
import forge_portal as fp


class _StubAtlas(BaseHTTPRequestHandler):
    """Minimal stand-in for code-atlas `/api/v1` GET routes."""

    health_doc: ClassVar[dict] = {"status": "ok", "service": "code-atlas-api", "version": 1}
    index_doc: ClassVar[dict] = {
        "items": [
            {
                "repository_id": 1,
                "root_handle": "E:/ws/repo",
                "ready_snapshots": 2,
                "latest_ready": 7,
                "counts": {"symbol_occurrences": 120, "file_inventory": 12},
            }
        ]
    }
    health_status: ClassVar[int] = 200
    index_status: ClassVar[int] = 200
    health_raw: ClassVar[bytes | None] = None

    def do_GET(self) -> None:
        if self.path == "/api/v1/health":
            body = (
                self.health_raw
                if self.health_raw is not None
                else json.dumps(self.health_doc).encode()
            )
            self._send(self.health_status, body)
        elif self.path == "/api/v1/index/status":
            self._send(self.index_status, json.dumps(self.index_doc).encode())
        else:
            self._send(404, json.dumps({"error": {"code": "not-found"}}).encode())

    def _send(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a) -> None:  # quiet
        pass


@pytest.fixture()
def stub():
    _StubAtlas.health_doc = {"status": "ok", "service": "code-atlas-api", "version": 1}
    _StubAtlas.index_doc = {
        "items": [
            {
                "repository_id": 1,
                "root_handle": "E:/ws/repo",
                "ready_snapshots": 2,
                "latest_ready": 7,
                "counts": {"symbol_occurrences": 120, "file_inventory": 12},
            }
        ]
    }
    _StubAtlas.health_status = 200
    _StubAtlas.index_status = 200
    _StubAtlas.health_raw = None
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _StubAtlas)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield _StubAtlas, base
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=5)


def _closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return port


class TestBaseUrl:
    def test_default_is_loopback_8741(self, monkeypatch):
        monkeypatch.delenv(atlas_ops.ATLAS_ENV_URL, raising=False)
        assert atlas_ops.atlas_base_url() == "http://127.0.0.1:8741"

    def test_env_override_kept_when_loopback(self, monkeypatch):
        monkeypatch.setenv(atlas_ops.ATLAS_ENV_URL, "http://localhost:9999")
        assert atlas_ops.atlas_base_url() == "http://localhost:9999"

    def test_foreign_host_refused(self):
        assert atlas_ops.atlas_base_url("http://192.168.1.10:8741") is None
        assert atlas_ops.atlas_base_url("http://atlas.internal") is None
        assert atlas_ops.atlas_base_url("ftp://127.0.0.1:8741") is None


class TestProbe:
    def test_available_with_index(self, stub):
        _cls, base = stub
        doc = atlas_ops.probe_atlas(base)
        assert doc["schema"] == "forge/PortalAtlasStatus/1"
        assert doc["state"] == "available"
        assert doc["service"] == "code-atlas-api"
        assert doc["api_version"] == 1
        assert doc["detail"] is None
        assert doc["checked_at"]
        idx = doc["index"]
        assert idx["repositories"] == 1
        assert idx["ready_snapshots"] == 2
        assert idx["items"][0]["counts"]["symbol_occurrences"] == 120

    def test_available_empty_index_is_real(self, stub):
        cls, base = stub
        cls.index_doc = {"items": []}
        doc = atlas_ops.probe_atlas(base)
        assert doc["state"] == "available"
        assert doc["index"]["repositories"] == 0
        assert doc["index"]["ready_snapshots"] == 0

    def test_degraded_when_health_http_error(self, stub):
        cls, base = stub
        cls.health_status = 503
        doc = atlas_ops.probe_atlas(base)
        assert doc["state"] == "degraded"
        assert doc["detail"] == "http-503"

    def test_degraded_when_health_not_ok(self, stub):
        cls, base = stub
        cls.health_doc = {"status": "starting", "service": "code-atlas-api", "version": 1}
        doc = atlas_ops.probe_atlas(base)
        assert doc["state"] == "degraded"
        assert doc["detail"] == "health-not-ok"

    def test_degraded_when_index_fails(self, stub):
        cls, base = stub
        cls.index_status = 500
        doc = atlas_ops.probe_atlas(base)
        assert doc["state"] == "degraded"
        assert doc["detail"] == "index:http-500"
        assert doc["health"]["status"] == "ok"

    def test_degraded_on_invalid_json(self, stub):
        cls, base = stub
        cls.health_raw = b"<html>not json</html>"
        doc = atlas_ops.probe_atlas(base)
        assert doc["state"] == "degraded"
        assert doc["detail"] == "invalid-json"

    def test_unavailable_when_refused(self):
        doc = atlas_ops.probe_atlas(f"http://127.0.0.1:{_closed_port()}")
        assert doc["state"] == "unavailable"
        assert doc["detail"] in ("connection-refused", "unreachable", "timeout")
        assert doc["index"] is None
        assert doc["health"] is None

    def test_unavailable_when_non_loopback(self):
        doc = atlas_ops.probe_atlas("http://10.0.0.5:8741")
        assert doc["state"] == "unavailable"
        assert doc["detail"] == "non-loopback-refused"


class _AtlasAdapter(fp.PortalAdapter):
    def __init__(self) -> None:
        self.ops = fp.default_operations(self) + atlas_ops.atlas_operations()


def _call(server: fp.PortalServer, path: str):
    req = urllib.request.Request(
        f"http://127.0.0.1:{server.port}/api/v1{path}",
        headers={fp.SESSION_HEADER: server.session_token},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class TestOperation:
    def test_op_envelope_and_named_state(self, stub, monkeypatch):
        _cls, base = stub
        monkeypatch.setenv(atlas_ops.ATLAS_ENV_URL, base)
        srv = fp.PortalServer(_AtlasAdapter(), quiet=True)
        thread = srv.serve_in_thread()
        try:
            status, env = _call(srv, "/atlas/status")
            assert status == 200
            assert env["schema"] == "forge/PortalApi/1"
            assert env["data"]["schema"] == "forge/PortalAtlasStatus/1"
            assert env["data"]["state"] == "available"
        finally:
            srv.shutdown()
            srv.server_close()
            thread.join(timeout=5)

    def test_op_reports_unavailable_not_500(self, monkeypatch):
        monkeypatch.setenv(
            atlas_ops.ATLAS_ENV_URL, f"http://127.0.0.1:{_closed_port()}"
        )
        srv = fp.PortalServer(_AtlasAdapter(), quiet=True)
        thread = srv.serve_in_thread()
        try:
            status, env = _call(srv, "/atlas/status")
            assert status == 200  # a named state is data, not a server error
            assert env["data"]["state"] == "unavailable"
            assert env["data"]["detail"]
        finally:
            srv.shutdown()
            srv.server_close()
            thread.join(timeout=5)
