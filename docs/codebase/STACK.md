# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript/Angular frontend plus Python server | `package.json`, `portal_core/`, `README.md` |
| Runtime + version | Angular 22, Node 22 CI, Python 3.12 CI | `package.json`, `.github/workflows/ci.yml` |
| Package manager | npm; pip for Python | `package.json`, CI |
| Module/build system | Angular CLI; Python stdlib/vendored server | `angular.json`, `README.md` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| Angular | ^22.2 | web UI | `package.json` |
| RxJS | ~7.8 | reactive browser streams | `package.json` |
| Cytoscape | ^3.34 | graph visualization | `package.json` |
| Python stdlib server | local | Portal API/static serving | `portal_core/`, README |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| Angular CLI | build/serve/test | `package.json`, `angular.json` |
| Vitest/jsdom/axe | frontend tests/a11y | `package.json` |
| pytest/Playwright | Python/server/browser E2E | `.github/workflows/ci.yml` |
| Prettier/Ruff | formatting/lint | `.prettierrc`, CI |

### 4) Key Commands

```bash
npm ci
npm run build
npm test -- --watch=false
python -m pytest tests/ -q
python -m pytest e2e/ -q
python scripts/vendor.py --check
```

### 5) Environment and Config

- Config sources: `angular.json`, `package.json`, `portal_core/`, `public/`, `.env` and docs.
- Required env vars: `[TODO]` — scan found `.env` but no committed template.
- Runtime constraint: Portal is a UI/control center and expects a compatible local API contract.

### 6) Evidence

- `package.json`
- `angular.json`
- `.github/workflows/ci.yml`
- `README.md`
