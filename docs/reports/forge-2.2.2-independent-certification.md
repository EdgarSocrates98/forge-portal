# Cycle 2.2.2 — Independent Certification

Reviewer composition: session agent (executed verifications) **+ context-isolated read-only subagent** (independent audit of all release workflows, dump tooling, dependency graph, and cross-boundary imports — its report was produced without access to the session's conclusions and is quoted in `publishing-workflow-review.md` / `release-dumps-review.md` / `ecosystem-independence-validation.md`).

## Certification matrix

| Area | Evidence artifact | Verdict |
|---|---|---|
| Baseline audit (9 mains, registries) | `docs/audits/forge-2.2.2-ecosystem-baseline.md` | **PASS** |
| Public install + runtime (7 PyPI + npm) | `docs/homologation/public-package-runtime-matrix.md` + `phase1-install-results.json` | **PASS** |
| Public-package E2E (CLI/portal/telemetry/read-only) | `docs/homologation/public-package-e2e-report.md` | **PASS** (portal federation depth PARTIAL) |
| sdist → wheel parity | `docs/release/sdist-wheel-reproducibility.md` + `sdist-wheel-results.json` | **PASS** (7/7 exact file-set parity) |
| Version consistency | `docs/release/version-consistency-matrix.md` | **PASS** (1 repo-manifest miss already fixed post-release; template tag-gate gap P2) |
| Release dumps security | `docs/security/release-dumps-review.md` + live `--check` run | **PASS with P1** (secret-pattern coverage extension recommended) |
| Publishing workflows | `docs/security/publishing-workflow-review.md` | **PASS with P1** (forge-cli `release.yml` token path bypasses OIDC/environment) |
| Execution keyboard journey | `docs/ux/execution-keyboard-validation.md` + `keyboard-e2e-evidence.json` | **PASS** (real Chrome, 9/9 steps, focus restored) |
| Graph Studio guard/perf | `docs/perf/graph-public-package-validation.md` | **PARTIAL** (guard verified + specs green; fresh 4-size headed run not re-executed — G-1) |
| Ecosystem independence | `docs/architecture/ecosystem-independence-validation.md` | **PASS** (DAG, zero cross-deps, all standalone) |

## Findings register (all residual, severity-ordered)

| ID | Sev | Finding |
|---|---|---|
| F-1 | **P1** | `forge-cli/.github/workflows/release.yml` — tag-push path publishes npm via long-lived `NPM_TOKEN`, workflow-wide `id-token: write`, no `environment:`, repacks instead of releasing the packed artifact, no post-publish verify. Bypasses the OIDC flow. |
| F-2 | P1 | `release_dumps.py` secret-pattern table misses AWS secret-key/PEM/`npm_`/`pypi-`/GCP/Azure shapes. |
| F-3 | P2 | Shared PyPI publish template lacks git-tag↔version check. |
| F-4 | P2 | `forge-doctor-data` `env_manifest.py` writes raw `sys.executable` path into shipped artifacts. |
| F-5 | P2 | `theforge-*-adapter` dists have no publish workflow — source-only; needs an intended/documented decision. |
| F-6 | P2 | npm bin is `forge-cli` while package is `theforge-cli` — `npx theforge` 404s; document the bin name in quickstarts. |
| F-7 | P2 | Events table needs ~40 Tab stops from top; consider a "jump to results" affordance (enhancement, not defect). |
| F-8 | P3 | `SIBLING_REPOS_TOKEN` / `APIFORGE_PR_TOKEN` least-privilege scope unverifiable from code — repo-settings check for owner. |
| F-9 | P3 | Orca/NVDA/VoiceOver AT runs `NOT_TESTED` (Orca probe exists in-tree; NVDA/VoiceOver unavailable on Linux). |
| G-1 | P2 | Fresh 4-size headed Graph Studio run not re-executed this cycle (guard path unchanged since measured; specs green). |
| R-1 | P2 | Portal↔installed-forge live federation not exercised (stub adapter path proven). |

## Certification statement

Public artifacts are independently installable, self-verifying, byte-parity reproducible, version-consistent, and dependency-isolated. Release pipelines are OIDC-first and fail-closed, **except** the `forge-cli` tag-push path (F-1). Critical UX (Execution Studio keyboard journey) is verified in a real browser with recorded focus evidence. Diagnostics are sanitized with an identified pattern-coverage gap (F-2).

**Cycle 2.2.2 certification: CERTIFIED WITH TWO P1 RESIDUALS (F-1, F-2) — both are bounded, documented, and have explicit remediation paths; neither invalidates the published artifacts' correctness.**

Freeze recommendation: enter functional freeze once F-1 is closed (remove or re-gate the `release.yml` npm publish); F-2 and P2s may land as normal hardening PRs inside freeze rules.
