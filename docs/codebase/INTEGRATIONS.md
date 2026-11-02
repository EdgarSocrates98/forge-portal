# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| Product Forge | local HTTP/PortalApi | products, boards, workspace data | local bearer/compatibility | high | `docs/fase0/contracts.md`, README |
| Forge Agent Bridge | local HTTP/event stream | chat sessions and provider events | paired bearer | high | `docs/architecture/`, ecosystem audits |
| Browser | frontend runtime | user interaction and rendering | browser session/local config | high | `src/`, `e2e/` |
| Filesystem | static/vendor artifacts | bundle and compatibility distribution | local permissions | medium | `scripts/vendor.py`, docs |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| API-owned stores | domain data | PortalApi clients | duplicate client-side truth | `docs/fase0/contracts.md` |
| Browser memory/state | view state | Angular services/signals | stale cross-feature state | `src/`, docs architecture |

### 3) Secrets and Credentials Handling

- Credential sources: local API/bridge token and configured host/provider auth; exact env inventory `[TODO]`.
- Hardcoding checks: `[TODO]` — scan found `.env` but no template.
- Rotation: should be delegated to one Product Forge-owned local control plane; current cross-repo policy is `[TODO]`.

### 4) Reliability and Failure Behavior

- UI includes diagnostics/offline and execution/replay evidence areas.
- API calls and event streams need explicit loading, empty, degraded and unavailable states.
- Cross-service retry/reconnect ownership is `[TODO]`.

### 5) Observability for Integrations

- CI uploads browser artifacts and docs define execution events/telemetry.
- Missing: shared correlation ID and a single user-facing health model spanning all three repositories.

### 6) Evidence

- `docs/fase0/contracts.md`
- `docs/observability/execution-events.md`
- `docs/security/portal-2.1-review.md`
- `e2e/`
