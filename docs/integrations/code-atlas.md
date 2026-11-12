# Code Atlas — portal integration contract

Read-only, loopback-only integration between a Forge portal and the
local `code-atlas` API. Verified against
`code-atlas-forge/src/code_atlas/api/server.py` + `handlers.py`.

## Surface (upstream)

| Property  | Value |
|---|---|
| Bind      | `127.0.0.1` only (unsafe binds refused by the atlas server) |
| Port      | `8741` (default; `code-atlas api serve --port`) |
| Prefix    | `/api/v1` |
| Auth      | none — the trust boundary is loopback + atlas-side Host/Origin allowlists |
| Transport | HTTP, JSON, `Cache-Control: no-store`, rate-limited |

The portal probe uses exactly two GET routes — nothing else, ever:

- `GET /api/v1/health` → `{"status": "ok", "service": "code-atlas-api", "version": 1}`
- `GET /api/v1/index/status` → `{"items": [{repository_id, root_handle, ready_snapshots, latest_ready, counts}]}`

Atlas itself is read-only over SQLite (`query_only` pragma); POST
endpoints exist upstream (`/context`, `/impact/analyze`) and are
deliberately out of scope for the portal.

## Portal side

- Canonical probe module: `portal_core/atlas_ops.py`, vendored to
  siblings as `<pkg>/_portal_atlas.py` (same opt-in module pattern as
  `_portal_telemetry.py`; vendored by `scripts/vendor.py`).
- Op: `GET /api/v1/atlas/status`, envelope `forge/PortalApi/1`, payload
  `forge/PortalAtlasStatus/1`.
- The Forge adapter registers it via `atlas_operations()`; other forges
  opt in the same way — a portal without the op returns 404 and the UI
  renders UNVERIFIED, not a crash.
- Target URL is **operator config** (`FORGE_ATLAS_URL`, default
  `http://127.0.0.1:8741`), never client input, and is validated
  loopback-only before any socket opens (SSRF guard).
- Per request: ≤ 2 GETs, ~1.5 s timeout each, no credentials, no body.
  The op's `cache_ttl` (~5 s) bounds refresh bursts; `checked_at` always
  reports the real probe time.

## Degradation — named states, never a spinner

`forge/PortalAtlasStatus/1.state` is the whole verdict:

| `state`       | Meaning | `detail` examples |
|---|---|---|
| `available`   | health "ok" **and** index/status answered — an empty repository list is real data | `null` |
| `degraded`    | the service answered badly: HTTP error, malformed JSON, health ≠ "ok", or index failed while health passed | `http-503`, `invalid-json`, `health-not-ok`, `index:http-500`, `index:timeout` |
| `unavailable` | no HTTP answer arrived — connection refused / timeout / unreachable — or the configured URL is not loopback | `connection-refused`, `timeout`, `unreachable`, `non-loopback-refused` |

`detail` is a **stable token** (snake-case), safe for localization and
assertions — it is not prose. `index:<token>` distinguishes the second
probe leg. The UI maps all three to explicit badges
(available/degraded/unavailable); `unavailable` renders the recovery
hint (`code-atlas api serve`) and is terminal for that request — the
portal never retries inside a render.

## UI

Explorer page (`/forges`): `atlas-status-panel` shows the verdict,
endpoint, service/version, `checked_at`, and — when `available` — the
index summary (repositories, ready snapshots, per-repo counts).

## Security posture (inherited, unchanged)

Portal server stays loopback-only, GET-allowlisted per op, session +
CSRF enforced. The probe adds no secrets, no cookies, no outbound
destinations besides a validated loopback URL, and no arbitrary file or
code execution — it is two typed GETs against a service whose own
surface is already hardened (host allowlist, no-store, rate limits).
