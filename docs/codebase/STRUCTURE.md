# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `src/` | Angular standalone application | `angular.json`, scan tree |
| `portal_core/` | Python Portal API/server | scan tree, README |
| `public/` | static assets | `angular.json` |
| `scripts/` | vendoring, parity and E2E helpers | scan tree |
| `tests/`, `e2e/` | server/unit/browser validation | CI workflow |
| `docs/` | architecture, security, installation, UX and audits | scan tree |

### 2) Entry Points

- Main frontend entry: `src/main.ts`; Angular CLI scripts in `package.json`.
- Python server entry: `[TODO]` — identify the exact executable from `portal_core/` and installation docs.
- Browser E2E: `e2e/` against real server and real bundle.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| Angular `src/` | navigation, screens, API clients, UI state | persistence truth duplicated from Product Forge |
| `portal_core/` | server/static delivery and PortalApi contract | provider-specific agent execution |
| `scripts/vendor.py` | copy/check compatibility artifacts | ad hoc runtime behavior |
| `docs/`/`e2e/` | contracts and evidence | production source |

### 4) Naming and Organization Rules

- Angular uses standalone components, signals, lazy routes and zoneless configuration as described in README/architecture docs.
- Python files use snake_case; frontend files follow Angular conventions.
- Built/vendored artifacts must be treated separately from source; CI checks parity.

### 5) Evidence

- `README.md`
- `angular.json`
- `src/main.ts`
- `scripts/vendor.py`
- `.github/workflows/ci.yml`
