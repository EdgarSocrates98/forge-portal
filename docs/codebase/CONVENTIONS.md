# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | Angular convention; Python snake_case | `src/main.ts`, `portal_core/...` | source tree |
| Components | Angular/PascalCase classes and selectors | `[TODO]` | `src/` |
| Functions/methods | TypeScript/Python conventional camelCase/snake_case | `[TODO]` | source/docs |
| Constants/env vars | CSS/design tokens and config names | `src/styles/tokens.css` | source tree |

### 2) Formatting and Linting

- Formatter: Prettier (`.prettierrc`); CI checks TS/HTML/CSS.
- Linter: Ruff for Python; Angular/TypeScript strict build is a gate.
- Run commands: `npx prettier --check "src/**/*.{ts,html,css}"`; `ruff check portal_core tests scripts e2e`; `ng build`.

### 3) Import and Module Conventions

- Angular standalone imports and lazy routes are the documented default.
- Public backend boundary is PortalApi; feature code should not call provider processes directly.
- Exact alias policy: `[TODO]`.

### 4) Error and Logging Conventions

- UI distinguishes diagnostics/offline/error states and supports accessibility checks.
- Backend contract and security conventions are documented in `docs/fase0/contracts.md` and `docs/security/`.
- Sensitive-data redaction specifics: `[TODO]`.

### 5) Testing Conventions

- Frontend tests use Angular CLI/Vitest/jsdom; browser E2E uses pytest/Playwright.
- Python tests live under `tests/`; E2E under `e2e/`.
- Coverage threshold: `[TODO]`; CI has build, unit, i18n, a11y and browser gates.

### 6) Evidence

- `.prettierrc`
- `package.json`
- `.github/workflows/ci.yml`
- `docs/testing/README.md`
