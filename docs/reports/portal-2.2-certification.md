# Portal 2.2 — Final certification report

Date: 2026-10-18 · Scope: stabilization, integration, performance, UX/a11y,
ecosystem homologation · Rule: automate implementation and verification,
never product decisions. Verdict per surface is one of
VERIFIED / PARTIAL / NOT_TESTED / UNSUPPORTED / BLOCKED.

## Cycle ledger

| Cycle | Deliverable | PR | Evidence |
|---|---|---|---|
| 0 baseline | HEAD audit, fresh gates, vendor drift measured, telemetry gap confirmed | #43 (doc cherry-picked into #50) | `docs/audits/portal-2.2-baseline.md` |
| 1 vendor | generation tracking in manifests, compat-generation tests, byte-parity re-vendor ×7 | #44 | `docs/audits/portal-2.2-vendor-matrix.md`, `tests/test_compat_generations.py` (11 tests) |
| 2 telemetry | canonical `telemetry.py` mypy-strict, vendored ×7, `event_sink` wired ×7 | #45, #47 + the-forge#96, api#91, aws#180, azure#72, platform#66, doctor-data#58, doctor-api#72 | `docs/audits/portal-2.2-telemetry-matrix.md` |
| 3 graph | adaptive layout policy, runaway guards, progressive render, measured benchmarks | #49 | `docs/perf/graph-scale-report.md` |
| 4 exec render | paginated row model, bounded DOM, timeline probe artifacts | #46 | `docs/perf/execution-rendering-report.md`, `e2e/artifacts/exec-render-cycle4*.json` |
| 5 UX/a11y | real Orca speech evidence, 100% / 200% / 400% reflow, high contrast, reduced motion, axe-core | #48 | `docs/reports/portal-2.2-cycle5-ux-a11y.md` |
| 6 homologation | production-like cross-forge E2E + security refusals + supply audit | this PR | below |

## Cycle 6 — cross-forge homologation (2026-10-18)

`scripts/portal_e2e.py` boots each forge's real `PortalServer` over real
HTTP against a scratch root — nothing mocked, nothing installed:

| Forge | checks | security refusals | telemetry |
|---|---|---|---|
| the-forge | 21/21 PASS | 403 no-session · forged plan_token 409 PORTAL-PLAN-STALE · traversal 404 | /events · /metrics · /tasks events → real `forge/PortalEventReport/1` |
| spark-forge-aws | 21/21 PASS | same | same |
| spark-forge-azure | 21/21 PASS | same | same |
| api-forge | 21/21 PASS | same | same |
| platform-forge | 21/21 PASS | same | same |
| forge-doctor-data | 21/21 PASS | same | same |
| forge-doctor-api | 21/21 PASS | same | same |

**147 checks, 7/7 PASS.** Honest states observed: every forge reports
`health.state = NOT_INSTALLED` and `installation/status = NOT_INSTALLED`
against a scratch root — the surface does not fabricate readiness.

Flow coverage per forge: session bootstrap → descriptor → capabilities →
health → installation status/plan/apply-refusal → hosts/skills/agents/
tasks/MCP/graphs read-only catalogs → telemetry window → traversal &
unknown-op refusals → task plan journey.

## Gates on final main

- `scripts/vendor.py --check`: 7/7 byte-parity — server `_forge_portal.py`
  (gen `a6bbc5f5…`) + `_portal_telemetry.py` (`0d7ce7ad…`) + **44** asset
  files (`052a06e2…`, Cycle 3–5 frontend generation), per-asset hashes and
  `server_generation`/`telemetry_generation` recorded in manifests.
  The Cycle 3–5 asset re-vendor to the siblings went out as
  the-forge#97 / api-forge#93 / platform-forge#67 / spark-aws#181 /
  spark-azure#73 / forge-doctor-data#58 / forge-doctor-api#73.
- Backend tests: **165 passed** (`tests/`, incl. compat generations,
  telemetry, security-cycle6, independence).
- Frontend: `npm test` + production build — see CI artifacts.
- `npm audit --omit=dev`: **0 vulnerabilities**; the Python backend is
  stdlib-only (`forge_portal.py`, `registry_ops.py`, `telemetry.py`) —
  zero runtime dependency surface.
- Python compatibility: `datetime.UTC` regression fixed (#47). CI covers
  py3.10 via sibling matrices (platform-forge 3.10–3.13, spark-aws/
  spark-azure 3.10+, the-forge 3.11–3.14, api-forge 3.12+, doctors
  3.11–3.13); forge-portal's own job pins a single 3.12 — the 3.10 path
  is exercised through the vendored copies on sibling CI.

## Verdicts by surface

| Surface | Verdict | Basis |
|---|---|---|
| Session/bootstrap/envelope | VERIFIED | 7× real HTTP, `forge/PortalApi/1` |
| Capabilities/health/install | VERIFIED | 7×, honest NOT_INSTALLED states |
| Security refusals (403/forged token/traversal/unknown op) | VERIFIED | 7× named codes, no stack leaks |
| Telemetry /events + /metrics | VERIFIED ×7 | real report schema, bounded buffer, redaction boundary |
| Task-scoped events | VERIFIED ×7 | metadata.task_id / correlation_id only — no timing inference |
| Graph Studio perf (adaptive layout, guards) | VERIFIED | `graph-scale-report.md` measured thresholds |
| Execution rendering (pagination, DOM bound) | VERIFIED | `execution-rendering-report.md`, probe artifacts |
| Keyboard navigation | VERIFIED | 100 scripted steps, 87 spoke via real Orca |
| Reflow 100/200/400% | VERIFIED | 252 captures, 0 page-level overflow, 0 bad clips |
| High contrast + reduced motion | VERIFIED | modes 9/9, axe-core 21 routes |
| Screen-reader (NVDA/VoiceOver) | NOT_TESTED | only Orca 46.1 exercised — declared gap |
| OS-level zoom | NOT_TESTED | emulated via CSS zoom, not OS setting |
| Moderated usability study | NOT_TESTED | scripted journeys only; 1 friction logged (≈58 keys through dense execution timeline) |
| Hosted/remote deployment | UNSUPPORTED | Portal is local-first by design |

## Independent review & rectifications

An independent reviewer reproduced the gates (pytest 165, E2E 147/147,
npm 542, audit 0) and flagged four issues, all rectified:

1. 🔴→fixed `vendor.py --check` was red at review time: the canonical
   `dist/` had been rebuilt (44 files, Cycle 3–5 frontend) after the
   first re-vendor. Re-vendored ×7 and pushed as the asset PRs listed
   above; `--check` is green again.
2. 🔴→fixed Vendored portals were serving the 2.1 bundle — the same
   re-vendor now ships the Cycle 3–5 UI (adaptive layout, pagination,
   WCAG keyboard rows) to all seven forges.
3. 🟡→fixed E2E telemetry checks accepted 404/409 as "recusa", which
   could not detect an unmount regression. The checks now require 200 +
   `forge/PortalEventReport/1` (all seven adapters opt in, so strict is
   correct), and `/tasks/{id}/events` is probed with a real task id when
   the tasks surface returns one.
4. 🟡→fixed Doc drift: this report, the vendor matrix date, and the
   py-version matrix wording were stale relative to the branch — all
   corrected in the follow-up commit.

## Known limitations (carried honestly)

1. Orca coalesced identical rows on 13/100 keyboard steps — speech
   evidence is real but coalescing is an AT behavior, not a portal defect.
2. Watchdog cannot preempt a synchronous layout engine block
   (`graph-scale-report.md` §watchdog).
3. Telemetry is opt-in per adapter generation; older vendored servers
   degrade silently (no fabricated UNSUPPORTED). The E2E's strict-200
   telemetry checks now detect that degradation on these seven forges.
4. E2E honest states reflect a scratch root; installed-state journeys are
   covered by per-repo unit/integration tests, not by this harness.
5. `HONEST_STATES` in the harness enumerates plausible states rather
   than asserting a specific one — a fabricated-but-plausible state
   would still pass; the observed `NOT_INSTALLED` ×7 is recorded above.
6. Frozen `site-packages` installs need `theforge install <forge>` (or a
   package update) to pick up the new vendored generation. The wheels
   published on 2026-10-18 (theforge-core 0.5.1 etc.) predate this
   re-vendor and ship the 2.1-generation frontend — the 2.2 generation
   reaches package installs with the next releases; checkouts on `main`
   already carry it.

## Verdict

**CERTIFIED** — all Portal 2.2 acceptance surfaces VERIFIED over real
HTTP, real browser, and real AT evidence, with the explicit NOT_TESTED /
UNSUPPORTED list above kept open instead of smoothed over.
