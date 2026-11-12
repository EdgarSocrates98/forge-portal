# atlas_ops.py — Code Atlas read-only probe for the portal.
#
# Lives OUTSIDE forge_portal.py on purpose (same pattern as
# registry_ops.py / telemetry.py): the vendored server stays a
# request/transport layer; this module is the adapter-side integration
# with code-atlas-forge's local read-only HTTP surface.
#
# Surface contract (code-atlas-forge src/code_atlas/api/server.py):
#   - binds 127.0.0.1 only; default port 8741 (`code-atlas api serve`)
#   - prefix /api/v1; GET-only for this integration (POST /context and
#     /impact/analyze exist but the portal never calls them)
#   - no auth, no cookies, no secrets — local trust boundary is
#     loopback + Host/Origin allowlists on the atlas side
#   - GET /api/v1/health      → {"status": "ok", "service": "code-atlas-api", "version": 1}
#   - GET /api/v1/index/status → {"items": [{repository_id, root_handle,
#     ready_snapshots, latest_ready, counts}]}
#
# Honesty contract (forge/PortalAtlasStatus/1):
#   - "unavailable": the probe could not reach the service (refused,
#     timeout, unreachable) OR the configured base URL is not loopback —
#     a named, terminal state, never a retry-forever spinner.
#   - "degraded": the service answered but is not healthy — health not
#     "ok", an HTTP error, malformed JSON, or the index endpoint failed
#     while health succeeded.
#   - "available": health answered "ok" AND index/status answered —
#     an empty repository list is real data, not a failure.
#   `detail` carries a stable failure token so the UI can localize
#   without parsing prose; `checked_at` is the real probe time.
#
# SSRF guard: the base URL is operator config (FORGE_ATLAS_URL env or
# the adapter default), never client input, and is validated loopback-
# only before any socket is opened.
#
# Opt-in (one line in an adapter):
#   self.ops += atlas_operations()

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import forge_portal as fp

ATLAS_SCHEMA = "forge/PortalAtlasStatus/1"
ATLAS_DEFAULT_URL = "http://127.0.0.1:8741"
ATLAS_TIMEOUT_S = 1.5
ATLAS_ENV_URL = "FORGE_ATLAS_URL"
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
_MAX_RESPONSE = 1 << 20  # 1 MiB — health/index payloads are small
# Failure tokens that mean "no HTTP answer ever arrived" → unavailable.
# Everything else (http-*, invalid-json, response-too-large) means the
# service answered, badly → degraded.
_TRANSPORT_FAILURES = {"connection-refused", "timeout", "unreachable"}


def atlas_base_url(raw: str | None = None) -> str | None:
    """Resolve the probe base URL — loopback only, else ``None``.

    ``FORGE_ATLAS_URL`` may point at a non-default port (tests, custom
    ``code-atlas api serve --port``); anything not on loopback is
    refused, never probed — the portal does not egress.
    """
    candidate = (raw if raw is not None else os.environ.get(ATLAS_ENV_URL, "")).strip()
    base = candidate or ATLAS_DEFAULT_URL
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if host not in _LOOPBACK_HOSTS:
        return None
    # normalize: no path/query — the probe owns the routes it calls
    netloc = parsed.netloc.rstrip("/")
    return f"{parsed.scheme}://{netloc}"


def _failure(exc: BaseException) -> str:
    """Named transport failure — stable token, never traceback text."""
    if isinstance(exc, urllib.error.HTTPError):
        return f"http-{exc.code}"
    if isinstance(exc, TimeoutError):
        return "timeout"
    reason = getattr(exc, "reason", exc)
    if isinstance(reason, ConnectionRefusedError):
        return "connection-refused"
    if isinstance(reason, TimeoutError):
        return "timeout"
    if isinstance(reason, OSError):
        # ECONNREFUSED wrapped in URLError on some platforms, plus
        # unreachable-network / DNS cases — all "cannot reach".
        if getattr(reason, "errno", None) in (10061, 111, 61):  # WSA/posix refused
            return "connection-refused"
        return "unreachable"
    return type(exc).__name__.lower()


def _get_json(base: str, path: str, timeout: float) -> tuple[Any | None, str | None]:
    """One GET against the atlas API. Returns (doc, None) or (None, token)."""
    url = f"{base}/api/v1{path}"
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(_MAX_RESPONSE + 1)
    except urllib.error.HTTPError as exc:
        return None, _failure(exc)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, _failure(exc)
    if len(raw) > _MAX_RESPONSE:
        return None, "response-too-large"
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "invalid-json"
    if not isinstance(doc, dict):
        return None, "invalid-json"
    return doc, None


def _index_projection(doc: dict[str, Any]) -> dict[str, Any]:
    """``/api/v1/index/status`` → compact, honest projection for cards."""
    items = doc.get("items")
    if not isinstance(items, list):
        items = []
    clean: list[dict[str, Any]] = []
    ready = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        rdy = item.get("ready_snapshots")
        ready += rdy if isinstance(rdy, int) else 0
        clean.append(
            {
                "repository_id": item.get("repository_id"),
                "root_handle": item.get("root_handle"),
                "ready_snapshots": rdy if isinstance(rdy, int) else None,
                "latest_ready": item.get("latest_ready"),
                "counts": item.get("counts") if isinstance(item.get("counts"), dict) else {},
            }
        )
    return {"items": clean, "repositories": len(clean), "ready_snapshots": ready}


def probe_atlas(base_url: str | None = None, timeout: float = ATLAS_TIMEOUT_S) -> dict[str, Any]:
    """forge/PortalAtlasStatus/1 — one honest verdict per call.

    Two real GETs (health, then index/status when health is ok). Every
    failure is named and terminal: the portal renders the state, it does
    not retry inside the request.
    """
    base = atlas_base_url(base_url)
    checked_at = fp._utc_now()
    doc: dict[str, Any] = {
        "schema": ATLAS_SCHEMA,
        "state": "unavailable",
        "url": base,
        "service": None,
        "api_version": None,
        "detail": None,
        "health": None,
        "index": None,
        "checked_at": checked_at,
    }
    if base is None:
        doc["detail"] = "non-loopback-refused"
        doc["url"] = (base_url or os.environ.get(ATLAS_ENV_URL, "")).strip() or None
        return doc

    health, failure = _get_json(base, "/health", timeout)
    if failure is not None:
        # Transport failure → the service is down; a malformed or
        # error HTTP answer → it is up but not healthy.
        if failure in _TRANSPORT_FAILURES:
            doc["detail"] = failure
            return doc
        doc["state"] = "degraded"
        doc["detail"] = failure
        return doc
    doc["health"] = health
    doc["service"] = health.get("service") if isinstance(health.get("service"), str) else None
    doc["api_version"] = health.get("version") if isinstance(health.get("version"), int) else None
    if health.get("status") != "ok":
        doc["state"] = "degraded"
        doc["detail"] = "health-not-ok"
        return doc

    index, failure = _get_json(base, "/index/status", timeout)
    if failure is not None:
        doc["state"] = "degraded"
        doc["detail"] = f"index:{failure}"
        return doc
    doc["index"] = _index_projection(index)
    doc["state"] = "available"
    return doc


def atlas_status() -> dict[str, Any]:
    """The op handler body — adapters may call this directly."""
    return probe_atlas()


def atlas_operations() -> list[fp.Operation]:
    """Compose into an adapter's ops list:
    ``fp.default_operations(a) + atlas_operations() + [...]``.

    ``GET /atlas/status`` — read-only probe of the local code-atlas API.
    ``cache_ttl`` matches /health: a refresh within the TTL replays the
    last REAL probe (still honest — `checked_at` reports its age) and a
    burst of portal clicks cannot hammer the atlas rate limiter.
    """
    return [
        fp.Operation(
            "GET",
            "/atlas/status",
            lambda ctx: atlas_status(),
            timeout=8.0,
            cache_ttl=5.0,
        ),
    ]
