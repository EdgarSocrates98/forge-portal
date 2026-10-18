"""Portal 2.2 Cycle 1 — cross-generation compatibility (§4.4).

The portal server must degrade cleanly against adapters of different
generations: a NEW server against an OLD adapter (capabilities absent)
and vice-versa. Each scenario spins the real server on an ephemeral port
— no mocking of the HTTP boundary.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "portal_core"))

import forge_portal as fp


class LegacyAdapter(fp.PortalAdapter):
    """Old-generation adapter: only mounts its own ops, does not implement
    health/capabilities hooks a new portal may call through
    default_operations' fallback path."""

    forge_id = "legacy-forge"
    forge_name = "Legacy Forge"
    cli = "legacy-forge"

    def __init__(self, assets: Path | None = None) -> None:
        self.assets_dir = assets
        self.ops = fp.default_operations(self) + [
            fp.Operation("GET", "/legacy-only", lambda ctx: {"ok": True}),
            fp.Operation(
                "GET",
                "/additive",
                lambda ctx: {"known": 1, "future_field": {"nested": [1, 2]}},
            ),
            fp.Operation(
                "GET",
                "/unverified",
                lambda ctx: {"status": "UNVERIFIED", "detail": "no probe ran"},
            ),
            fp.Operation("GET", "/explode", _explode),
            fp.Operation(
                "GET",
                "/secret",
                lambda ctx: {"token": "ghp_secretvalue123", "note": "x"},
            ),
        ]


def _explode(ctx):
    raise RuntimeError("boom — internals must not leak")


class NewAdapter(LegacyAdapter):
    """New-generation adapter: mounts telemetry-shaped custom ops on top
    of the same server generation (old portal + new adapter case)."""

    def __init__(self, assets: Path | None = None) -> None:
        super().__init__(assets)
        self.ops = self.ops + [
            fp.Operation(
                "GET",
                "/new-surface",
                lambda ctx: {"schema": "forge/Future/1", "items": []},
            )
        ]


@pytest.fixture(scope="module")
def assets(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("assets-compat")
    (d / "index.html").write_text("<html>portal</html>", encoding="utf-8")
    return d


def _serve(adapter: fp.PortalAdapter):
    srv = fp.PortalServer(adapter, host="127.0.0.1", port=0)
    thread = srv.serve_in_thread()
    return srv, thread


def _get(srv: fp.PortalServer, path: str) -> tuple[int, dict]:
    url = f"http://127.0.0.1:{srv.port}/api/v1{path}"
    req = urllib.request.Request(
        url, headers={fp.SESSION_HEADER: srv.session_token}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


@pytest.fixture(scope="module")
def legacy_server(assets):
    srv, thread = _serve(LegacyAdapter(assets))
    yield srv
    srv.server_close()
    thread.join(timeout=5)


@pytest.fixture(scope="module")
def new_adapter_server(assets):
    srv, thread = _serve(NewAdapter(assets))
    yield srv
    srv.server_close()
    thread.join(timeout=5)


# portal novo × adapter antigo ------------------------------------------------


def test_missing_capability_returns_structured_404() -> None:
    """An optional adapter attribute set to None → PORTAL-UNSUPPORTED 404,
    not a 500 — the `_get(attr, None)` fallback inside default_operations."""

    class NoHealthAdapter(LegacyAdapter):
        health = None

    srv = fp.PortalServer(NoHealthAdapter(None), host="127.0.0.1", port=0)
    thread = srv.serve_in_thread()
    try:
        status, body = _get(srv, "/health")
        assert status == 404
        assert body["error"]["code"] == "PORTAL-UNSUPPORTED"
    finally:
        srv.server_close()
        thread.join(timeout=5)


def test_missing_health_falls_back_to_adapter_default(legacy_server) -> None:
    """`/health` falls back to `adapter.health()` — PortalAdapter provides a
    minimal default so the endpoint stays up for old adapters."""
    status, body = _get(legacy_server, "/health")
    assert status == 200
    assert body["data"]["state"]


def test_default_capabilities_surface(legacy_server) -> None:
    """PortalAdapter ships a default capabilities() — old adapters keep
    serving the endpoint with a valid (possibly empty) surface."""
    status, body = _get(legacy_server, "/capabilities")
    assert status == 200
    assert isinstance(body["data"], list)


def test_custom_legacy_op_still_works(legacy_server) -> None:
    status, body = _get(legacy_server, "/legacy-only")
    assert status == 200
    assert body["data"] == {"ok": True}


def test_unavailable_endpoint_is_404_envelope(legacy_server) -> None:
    status, body = _get(legacy_server, "/does-not-exist")
    assert status == 404
    assert body["error"]["code"]


# contratos aditivos / UNVERIFIED ---------------------------------------------


def test_additive_fields_pass_through(legacy_server) -> None:
    """Unknown/future fields in adapter payloads are not stripped — the
    contract is additive; the frontend tolerates extras."""
    status, body = _get(legacy_server, "/additive")
    assert status == 200
    assert body["data"]["future_field"] == {"nested": [1, 2]}


def test_unverified_state_flows_through(legacy_server) -> None:
    status, body = _get(legacy_server, "/unverified")
    assert status == 200
    assert body["data"]["status"] == "UNVERIFIED"


# falhas de comunicação --------------------------------------------------------


def test_handler_exception_is_generic_500(legacy_server) -> None:
    """A crashing handler returns the PORTAL-INTERNAL envelope — internals
    (RuntimeError message, traceback) never reach the wire."""
    status, body = _get(legacy_server, "/explode")
    assert status == 500
    assert body["error"]["code"] == "PORTAL-INTERNAL"
    assert "boom" not in json.dumps(body)
    assert "Traceback" not in json.dumps(body)


def test_secrets_redacted_on_the_wire(legacy_server) -> None:
    status, body = _get(legacy_server, "/secret")
    assert status == 200
    assert "ghp_secretvalue123" not in json.dumps(body)


# portal antigo × adapter novo -------------------------------------------------


def test_old_server_serves_new_adapter_superset(new_adapter_server) -> None:
    """An adapter mounting MORE ops than the old portal knew works: the
    server dispatches by op table, not by version negotiation."""
    status, body = _get(new_adapter_server, "/new-surface")
    assert status == 200
    assert body["data"]["schema"] == "forge/Future/1"


def test_new_adapter_keeps_legacy_ops(new_adapter_server) -> None:
    status, body = _get(new_adapter_server, "/legacy-only")
    assert status == 200
    assert body["data"] == {"ok": True}
