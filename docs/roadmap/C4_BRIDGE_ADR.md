# ADR C4-001 — Forge Local Bridge: adapter-extension vs separate bridge

Status: **accepted — no bridge** (study outcome, spec §4.2)
Date: 2026-10-14 · Cycle: C4 (`005-c4-hosts-mcp-agents`)

## Decision required (§4.2)

> "First evaluate if the vendored backend already covers needed local
> ops; only build if a proven functional gap; ADR comparing
> adapter-extension vs separate bridge is mandatory either way."

## Evidence — what the vendored backend + adapters already cover

The byte-parity `portal_core/forge_portal.py` (vendored into every
Forja as `_forge_portal.py`) provides, out of the box, every property
§4.2 would require from a bridge:

| §4.2 bridge property | Already provided by                                      |
| -------------------- | -------------------------------------------------------- |
| loopback only        | `_host_ok()` — Host must be 127.0.0.1/localhost/::1      |
| session auth         | 128-bit token → `X-Forge-Session` header, per process    |
| typed op registry    | `PortalAdapter.ops` — `Operation` dataclass, no shell    |
| no arbitrary shell   | ops are typed handlers; CSP forbids inline; no exec path |
| payload/rate limits  | 1 MiB body cap, 10 mutating POST/min, per-op timeout     |
| auditing             | correlation ids, structured envelopes, server log        |
| secret hygiene       | `redact()` scrub on every response + SSE event           |
| explicit lifecycle   | `serve()`/`PortalServer.serve_in_thread`, clean shutdown |
| mutating consent     | `confirm` literal + HMAC `plan_token` bound to plan      |

Verified live against the real adapters (api-forge, 17 ops; all 7
Forjas carry adapters with the same contract):

- **Local ops needed by C4 are all adapter ops**: host inventory
  (`GET /hosts` — real probe incl. `logged_in` tri-state), host launch
  command (`POST /hosts/launch` — returns copyable command; never
  launches, honoring the no-TTY decision), MCP registry + handshake
  verification (`GET /mcp/servers`, `POST /mcp/verify` — real
  initialize+tools/list doc), skills/agents catalogs (`GET /skills`,
  `GET /agents` — parsed from real markdown), tasks (`/tasks/*` with
  plan tokens), installation ops (`/installation/*`), federation
  (`/federation*` on orchestrating Forjas), docs search, profiles,
  graphs.
- **Where a surface is absent it is a _data_ gap, not an ops gap**:
  adapters don't yet expose plan-integration/fix/disable for hosts,
  tool/resource/prompt listings for MCP, or config writes. Those are
  contract-level additions to `PortalAdapter.ops` — they do not need a
  second process, a second session model, or a second audit surface.

## Options compared

**A. Adapter-extension (chosen).** New read/mutation ops are added to
each Forja's adapter as concrete requirements land (e.g. C5 needs
repair/execution ops → `POST /hosts/plan`, `POST /config/apply` if the
Forja supports them). Zero new processes; every property above stays
free; capability absence surfaces as `PORTAL-NOT-FOUND` → the UI shows
UNVERIFIED honestly.

**B. Separate Forge Local Bridge.** A sibling local service exposing
local ops to the portal. Cost: a second session/auth/audit/rate-limit
surface, a second lifecycle to keep alive, a new trust boundary, and a
new mandatory-runtime temptation — violating §0.3 (no new mandatory
component) unless it buys capability the adapter path cannot express.
Nothing in C4 requires it: every needed op is expressible as a typed
adapter op, and §4.1/§8 forbid the one thing a bridge would uniquely
offer (generic local command execution).

## Decision

**No bridge.** The gap §4.2 asks us to prove is absent: the vendored
backend IS the bridge (local, loopback, typed, audited, consented).
When concrete ops are missing they extend `PortalAdapter.ops` (option
A) — keeping a single trust surface and byte-parity vendoring.

Revisit triggers (recorded, not built): a requirement needing a
persistent local daemon (e.g. watching install registries across portal
sessions), or ops that cannot fit the request/response+SSE model. None
exist in C4 scope.

## Appendix — host state models (CLI ↔ Portal) MUST NOT diverge

Constraint (spec): "same honest state model; Portal and CLI must not
diverge on what 'integrated' means." The two models use different
granularity but the same monotonic ladder and the same auth rule:

| CLI (`src/hosts/types.ts` HostState) | Portal (`HostLifecycleState`)               | Evidence required                                      |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| `absent`                             | `NOT_DETECTED`                              | binary/config probe found nothing                      |
| `installed`                          | `DETECTED`/`INSTALLED`                      | binary probe hit (version when parsable)               |
| `configured`                         | `CONFIGURED`                                | config dir/file exists for the host                    |
| `authenticated`                      | — (axis: `logged_in` tri-state)             | real auth probe only (CLI `auth:verified`)             |
| `integrated`                         | `MCP_REGISTERED`                            | integration record present in host config              |
| `validated`                          | `HANDSHAKE_VERIFIED` … `EXECUTION_VERIFIED` | live handshake/tools/invocation evidence               |
| —                                    | `FAILED` / `BLOCKED`                        | adapter probe result; CLI surfaces via `detail`/errors |

Shared rules both sides implement:

- **auth is a separate axis, never inferred** — CLI `auth:'verified'`
  only after a documented probe exits 0; Portal `logged_in` is
  tri-state (`null` = unknown). Absence of a probe ⇒ `unknown`, and
  the state ladder can still rise only on real integration evidence.
- **`integrated`/`validated` require records, not inference** —
  detection alone never yields them; `detect()` in the CLI never
  reports `validated`.
- **absent surfaces ⇒ `unverified`, never success** — both render
  explicit unknown states.

Guard: `forge-cli/tests/hosts-mapping.test.ts` pins the CLI literals;
the table above is the contract — changes to either model must update
this ADR.

## Consequences

- Portal pages render adapter-absent capabilities as UNVERIFIED — this
  is the honest cost of not building a bridge (and why it isn't one).
- C5's execution/repair surface extends `PortalAdapter.ops` in Forjas
  that support it — no bridge work scheduled.
