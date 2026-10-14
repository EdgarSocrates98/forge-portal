# F0 Baseline Audit — forge-portal

Program: `prompt_evo_cli_portal.md` §1 (Fase Zero). Audited on 2026-10-14
against the real `main` checkout.

## §1.1 — Repository identity

| Item         | Value                                                             | Evidence                       |
| ------------ | ----------------------------------------------------------------- | ------------------------------ |
| Branch       | `main`                                                            | `git branch --show-current`    |
| HEAD SHA     | `2b2debc4b5cff460ccb7407b27471a41bce8229e`                        | `git rev-parse HEAD`           |
| Remote       | `https://github.com/EdgarSocrates98/forge-portal.git`             | `git remote -v`                |
| Package      | `forge-portal-app@0.0.0` (Angular 22, signals, standalone)        | `package.json`, `angular.json` |
| History      | real merge/PR history on `main` (PRs #12, #14, #15 merged)        | `git log --oneline`            |
| Open PRs     | none                                                              | `gh pr list` (authenticated)   |
| Working tree | clean except untracked `nul` file (pre-existing Windows artifact) | `git status`                   |

Remote branches exist for prior evolution work (`codex/*`, `feat/*`) — all
behind `main`'s HEAD or stale; none conflict with F0.

## Quality gate results (run verbatim)

| Command                              | Result | Evidence                                                                                                                                       |
| ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                             | OK     | node_modules populated                                                                                                                         |
| `npm run build` (ng build)           | OK     | 325 KB initial (86.7 KB transfer), 12 lazy routes + en/pt-br i18n chunks, 18.7s                                                                |
| `npm test` (ng test, vitest)         | OK     | **3 spec files, 11 tests, all passing**, ~33s — frontend unit coverage is thin                                                                 |
| `npx prettier --check "src/**/*"`    | OK     | all matched files clean                                                                                                                        |
| `python -m pytest tests/`            | OK     | **45 tests in 2.22s** (server contract, sessions, CSRF, rate limit, traversal, plan tokens, redaction, envelope)                               |
| `python -m pytest e2e/` (Playwright) | OK     | **12 tests in 37.9s — real Chromium**: boot session → UI → navigation → install plan/apply flow end-to-end, screenshots under `e2e/artifacts/` |

Environment limits (§14.3): Playwright + Chromium present in this env —
browser E2E executed for real. `e2e/` requires `dist/` (built before run).
No mobile/tablet viewport beyond the existing restricted-viewport test.

## §1.3 — Mandatory inventory, walked

### Python backend (`portal_core/forge_portal.py`, 913 lines, stdlib-only)

Vendored module designed for byte-parity distribution: every Forja ships it
verbatim as `<pkg>/_forge_portal.py` (`forge-doctor-api` keeps it under
`scripts/` to preserve its no-network-imports-in-src rule — vendor.py:46-48).

- **Contract**: `forge/PortalApi/1` envelope `{schema, correlation_id, data|error}`.
- **Security model — all verified in code** (`PortalServer`, `PortalHandler`):
  loopback-only bind enforced in constructor (`host not in ("127.0.0.1",
"localhost", "::1")` → `ValueError`); 128-bit session token, `X-Forge-Session`
  header required on every `/api/v1` call + SameSite=Strict HttpOnly
  `forge_session` cookie; **Host-header loopback allowlist = DNS-rebinding
  guard**; POST requires Origin loopback allowlist + `Content-Type:
application/json`; 1 MiB body cap; 10 mutating POST/min token bucket;
  per-op timeouts via ThreadPoolExecutor; request-body draining on reject
  (fixes WinError 10053); response payload scrub via secret-key allowlist
  redaction (`plan_token` deliberately exempt — it must round-trip).
- **Plan tokens**: HMAC-SHA256 over canonical JSON + timestamp + plan-hash
  prefix, 15-minute TTL — binds `plan` output to `apply` input
  (`make_plan_token`/`check_plan_token`, lines 350-370).
- **`Operation` registry**: typed `method, path, mutating, confirm literal,
needs_plan_token, timeout`. Unknown op → `PORTAL-NOT-FOUND`. No shell —
  handlers are Python callables supplied by the adapter.
- **`PortalAdapter` contract**: `forge_id/name/version/cli/theme/federated/
assets_dir/workspace`, `descriptor()`, `capabilities()`, `nav()`,
  `health()`, `account_environment()`, `register(op)`.
- **`default_operations`** (free, read-only): `/bootstrap` (descriptor +
  health + account_environment), `/health`, `/environment`,
  `/capabilities`, `/installation/status` — all enriched with portal
  presence (`detect_forge_portal`) and `forge/InstallEnvironment/v1`
  (`detect_account_environment`: `FORGE_ID_{HOME,INSTALL_ROOT,VENV,PYTHON,
CLI,LAUNCHER}` presence+validity — never echoes arbitrary env, never reads
  values beyond paths).
- **Static serving**: traversal-proof (`..` normalization + `relative_to`
  containment), SPA fallback, session-token-in-URL → cookie upgrade,
  security headers (CSP, nosniff, Referrer-Policy no-referrer, no-store).
- **SSE**: `SseResult` streams `data:` events through the same redactor —
  used by task execution ops.
- **Structured errors**: `PortalError` → stable `code`, `message_key`,
  `severity`, `retryable`, `action`, `details`; internal errors never leak
  (`PORTAL-INTERNAL`).

**Adapters are NOT in this repo** — they live per-Forja (see Integration).

### Angular app (`src/app/`)

- `app.routes.ts` — 12 lazy standalone routes: `dashboard`, `install`,
  `federation`, `profiles`, `hosts`, `mcp`, `skills`, `agents`, `tasks`,
  `graph`, `knowledge`, `settings` (+ redirect/fallback). 3,611 LOC across
  pages; biggest: `install` (731), `federation` (686), `dashboard` (482),
  `tasks` (319).
- `core/api/api.models.ts` (300 lines) — 1:1 typed mirror of
  `docs/fase0/contracts.md`: `PortalDescriptor`, `PortalCapability`,
  `PortalHealth` (InstallState ×8), `AccountEnvironment`
  (`forge/InstallEnvironment/v1`), `HostDetection` (HostLifecycleState ×10 —
  NOT_DETECTED→EXECUTION_VERIFIED/BLOCKED), `McpServerDescriptor` (McpState
  ×8), `SkillDescriptor`, `AgentDescriptor`, `TaskExecution`/`TaskEvent`,
  `GraphBundle`/`GraphAvailability`, `DocHit`, `FederationSnapshot`,
  `FederationSelection`, `InstallationReceipt`. **Presence semantics are
  honest**: `null` = known-absent; missing key = unverified — never collapsed.
- `core/api/api.client.ts` — `PortalApi` typed client: unwraps envelopes,
  validates `forge/PortalApi/1`, surfaces `ApiError`. Read surface:
  bootstrap/health/capabilities/installation/environment/federation/
  profiles/hosts/mcp/skills/agents/tasks/graphs/docs-search. Mutation
  surface (all `confirm`+`plan_token` where applicable): installation
  plan/apply/repair/uninstall, federation plan/install-auto, profiles apply,
  hosts launch, mcp verify, tasks plan/execute.
- `core/` — session store (token from URL → `X-Forge-Session` header +
  cookie), portal store, theme store, error interceptor, i18n service +
  `en`/`pt-br` locales.
- `shared/` — command palette, empty/error states, forge-documentation,
  icons, page headers, state badges — design-system primitives.
- **No mock data**: the only `mock|placeholder|TODO` hits in `src/app` are
  i18n `placeholder` attributes and comment words — pages render whatever
  `PortalApi` returns, including `unverified`/`NOT_APPLICABLE` states.

### What "operational" means here (§1.3 warning honored)

A page exists AND its data path is typed — but the _real_ data comes from
the serving Forja's adapter, not from this repo. The browser E2E suite
(12 tests, Chromium) exercises the full UI against a real `PortalServer`
with an `E2EAdapter` that registers real plan/apply ops — so rendering,
session handshake, plan→confirm→apply UX, and navigation are verified.
Per-Forja data fidelity is verified by each Forja's own adapter tests
(e.g. `api-forge/tests/test_portal_adapter.py`).

### Distribution (`scripts/vendor.py`, `scripts/portal_e2e.py`)

- `vendor.py` propagates `portal_core/forge_portal.py` →
  `<repo>/<pkg>/_forge_portal.py` and `dist/…/browser/*` →
  `<repo>/portal/assets/` + `manifest.json` (`forge/PortalAssets/1`:
  sha256+size per file) — tamper/drift detection at serve time. `--check`
  is the drift gate. Per-Forja exceptions encoded (doctor-data ships assets
  inside the package for poetry wheels; doctor-api goes to `scripts/`).
- `portal_e2e.py` (284 lines) — local dev/E2E server wiring.
- `scripts/check_i18n.py` — locale key parity check.

### Existing docs (no duplication allowed — §1.5)

`docs/fase0/` (architecture, capability-map, contracts, distribution-plan,
security-matrix), `docs/fase1/` angular-shell, `docs/fase2/` server-report,
`docs/final-hardening/` (baseline, fase1-portal-core, fase9-release),
`docs/installation/` (+federation-onboarding), `docs/testing/`,
`docs/engineering-excellence/ux-readiness.md`, `docs/release/`,
`fase9-release-report.md`. The fase0 security matrix + capability map are a
prior audit of the **consumer Forjas'** adapter surfaces — still accurate
per this audit's spot-checks (skills catalog counts, `NOT_APPLICABLE`
policy, Copilot `logged_in: null` honesty).

## Integration points evaluated (consumer Forjas — read-only)

| Check                              | Result                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendored `_forge_portal.py` parity | **byte-parity in all 7 Forjas** — same sha256 (`701cfe13…`) as `portal_core/forge_portal.py`                                                                                                                   |
| Real adapters                      | `the-forge` 20 ops / 1057 LOC; `api-forge` 17 / 881; `forge-doctor-data` 17 / 750; `platform-forge` 17 / 740; `spark-forge-aws` 17 / 716; `spark-forge-azure` 17 / 722; `forge-doctor-api` (scripts/) 17 / 672 |
| `_installkit.py` vendored          | 6 Forjas (all but forge-doctor-api, which uses `scripts/forge_install.py` + canonical `the-forge/scripts/installkit/forge_installkit.py`)                                                                      |
| `_graphstudio.py` vendored         | 6 Forjas                                                                                                                                                                                                       |
| Local install registry             | `~/.forge/installations/*.json` live on this machine for all 7 Forjas — adapter health/detection has real data to consume                                                                                      |
| Frontend↔contract drift            | api.client.ts method set ⊇ contracts.md endpoint list; `default_operations` ⊆ adapter op lists                                                                                                                 |

## Snapshot verdict

forge-portal on `main` is **far beyond the §0.4 sketch**: a hardened
loopback server with session/CSRF/rate-limit/plan-token security and
byte-parity vendoring already shipped; a 12-route Angular shell whose
pages all consume the real `forge/PortalApi/1` contract; adapters live in
all 7 Forjas with 17–20 ops each; 12 real-browser E2E tests pass.
Gaps vs the program (360° multi-forge dashboard, execution center depth,
self-healing classes, observability surface, canonical contract set,
performance baselines) are enumerated in `forge-cli/docs/roadmap/
CAPABILITY_GAP_MATRIX.md`.
