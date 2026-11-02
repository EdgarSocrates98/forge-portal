# Architecture

## Core Sections (Required)

### 1) Architectural Style

- Primary style: frontend control-center shell over a local Python API, with lazy feature routes and contract-driven federation.
- Why: README names Angular standalone/signals/lazy routes/zoneless and a Python stdlib vendored server; docs define PortalApi and federation onboarding.
- Primary constraints: read-only by default, plan → review → confirm → execute → verify → receipt, and no fake buttons.

### 2) System Flow

```text
browser route -> Angular feature/client -> PortalApi/local server -> Product Forge or compatible forge -> response/events -> rendered state/receipt
```

1. Angular bootstraps the shell and lazy routes.
2. A feature calls the PortalApi contract rather than provider processes directly.
3. The Python server serves static assets and local API behavior.
4. Federated operations are planned and reviewed before execution.
5. Results are rendered as state, diagnostics, events or receipts.

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|-------------|----------|
| Angular shell | navigation, localization, feature composition | provider process lifecycle | `src/`, README |
| feature modules | product/board/chat/graph UX | second backend truth | `docs/architecture/`, src |
| PortalApi/server | local API/static compatibility | agent-provider semantics | `portal_core/`, docs/fase0/contracts.md |
| vendor scripts | parity distribution | user-facing orchestration | `scripts/vendor.py` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| lazy route feature modules | Angular config/src | keep shell and feature loading separate |
| contract adapter/vendor parity | `PortalApi`, `scripts/vendor.py` | integrate sibling forges without checkout coupling |
| plan/review/confirm/receipt | README/docs | protect consequential local actions |

### 5) Known Architectural Risks

- The UI depends on a PortalApi compatibility layer while the actual Product Forge/Bridge runtime has separate contracts.
- Vendor parity checks prove copied bytes, not semantic compatibility of all three running processes.
- Multiple feature surfaces can fragment chat, board and product navigation unless Product Forge is the sole domain source.

### 6) Evidence

- `README.md`
- `docs/fase0/contracts.md`
- `docs/architecture/`
- `scripts/vendor.py`
