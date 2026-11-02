# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: Angular CLI unit tests with Vitest/jsdom plus pytest and Playwright.
- Assertion/a11y tools: Vitest/jsdom and axe-core; browser E2E uses Playwright.
- Commands:

```bash
npm ci
npx ng build --configuration production
npx ng test --watch=false
python -m pytest tests/ -q
python -m pytest e2e/ -q
```

### 2) Test Layout

- Frontend tests are in the Angular source/test setup; Python tests under `tests/`; browser journeys under `e2e/`.
- E2E artifacts are stored under `e2e/artifacts/`.
- CI also runs i18n parity and vendor parity.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | yes | Angular components/services and Python server | CI gate |
| Integration | yes, partial | PortalApi/server/federation | sibling integration can be skipped with `|| true` in CI |
| E2E | yes | real server + real bundle/browser | does not prove real provider end-to-end |

### 4) Mocking and Isolation Strategy

- Main approach: in-process server fixtures and browser against a real local bundle.
- Isolation: CI checkout, local server and uploaded artifacts.
- Common failure mode: UI tests pass against a compatibility fixture while the installed Product Forge/Bridge topology differs.

### 5) Coverage and Quality Signals

- Coverage threshold: `[TODO]`.
- Strong signals: strict production build, i18n parity, accessibility checks, browser E2E, vendor parity.
- Gap: required system E2E after `productforge install` with a real provider session.

### 6) Evidence

- `.github/workflows/ci.yml`
- `package.json`
- `e2e/`
- `docs/testing/README.md`
