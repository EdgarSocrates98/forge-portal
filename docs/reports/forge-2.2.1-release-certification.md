# The Forge — Release 2.2.1 Certification

Date: 2026-10-18 · Program: `prompt_evo_portal2.3.md` (Cycle 2.2.1 — Release & Adoption Readiness)

## Published releases

| Projeto | Fonte (main merge) | Publicado | Instalado | E2E | Status |
|---|---|---|---|---|---|
| the-forge | `theforge-core` 0.5.2 · f703708 | PyPI 0.5.2 ✓ | 0.5.2 (py3.11–3.14) | portal+telemetry live | **CERTIFIED** |
| api-forge | `apiforge-af` 0.1.2 · a3b67e3 | PyPI 0.1.2 ✓ | 0.1.2 (py3.12–3.14) | — | **CERTIFIED** |
| platform-forge | `platformforge` 0.1.2 · 214728e | PyPI 0.1.2 ✓ | 0.1.2 (py3.10–3.14) | — | **CERTIFIED** |
| spark-forge-aws | `sparkforge-aws` 0.5.2 · 805224e | PyPI 0.5.2 ✓ | 0.5.2 (py3.10–3.14) | — | **CERTIFIED** |
| spark-forge-azure | `sparkforge-azure` 0.1.2 · f0c7c57 | PyPI 0.1.2 ✓ | 0.1.2 (py3.10–3.14) | — | **CERTIFIED** |
| forge-doctor-data | 1.0.2 · 41bdd4f | PyPI 1.0.2 ✓ | 1.0.2 (py3.11–3.14) | — | **CERTIFIED** |
| forge-doctor-api | 0.2.2 · 80a845b | PyPI 0.2.2 ✓ | 0.2.2 (py3.11–3.14) | n/a (no portal in wheel — BY_DESIGN) | **CERTIFIED** |
| forge-cli | `theforge-cli` 0.2.1 · unchanged | npm 0.2.1 (previous round) | 0.2.1 (node 22) | CLI --version ✓ | **CERTIFIED** |
| forge-portal | canonical ce56675 | vendored only | — | — | source of truth |

## Clean install matrix (Cycle 5) — from public registry only

34/34 cells PASS: every package installed via `pip --index-url https://pypi.org/simple`
into a fresh venv on each declared Python (3.10–3.14; below-min cells SKIPPED per
requires-python) and its console script reported the correct `--version`.
npm: `npm i theforge-cli@0.2.1` → `forge-cli --version` = 0.2.1 (bin works, 9-file
tarball, no forbidden files).

## Distributed E2E (Cycle 10)

- Installed `theforge-core==0.5.2` from PyPI in clean venv → `theforge portal`
  boots, session token issued, `GET /` = 200 with full security headers
  (CSP, X-Frame-Options, SameSite=Strict cookie).
- `GET /api/v1/events` (X-Forge-Session) → `forge/PortalEventReport/1`,
  live counters (operation.start/end observed).
- `GET /api/v1/metrics` → counters+events. Telemetry = live, not stub.
- Installed package contains the **2.2.1 generation**: 44 portal assets
  incl. new UX chunks (chunk-CdjWoiPd, chunk-CMtL9dJD, …), `_portal_telemetry.py`,
  `_forge_portal.py` with `timezone.utc` (py3.10-safe).
- forge-doctor-api wheel intentionally contains no portal files (its model
  detects an external forge-portal install; portal remains optional) —
  declared `NOT_SHIPPED / BY_DESIGN`.

## Cycle outcomes

- **C0 baseline**: published wheels were 2.1-generation (42 assets, no
  telemetry) while source carried 2.2 → patch round required. Doc:
  `docs/release/cycle-2.2.1-package-baseline.md`.
- **C1 packaging**: 6/7 wheels verified to contain 2.2.1 assets + telemetry +
  utc-fix server; sdist→wheel rebuild reproduced content (the-forge);
  forbidden-file scan = only benign fixtures (AWS example key in
  `secrets-noleak` eval fixture, module names).
- **C2 safe dumps**: `scripts/release_dumps.py` (44 tests, 209 total pass).
  Evidence in CI artifacts / release artifacts; schemas
  `forge/ReleaseInventory/1`, `VendorIntegrity/1`, `WheelManifest/1`,
  `NpmPackManifest/1`; safe-mode redaction verified.
- **C3 PyPI pipelines**: all 7 repos now build-once → publish-same-artifact
  (sha256-verified download) → OIDC `environment: release` → post-publish
  clean-venv verify. Version gate: input↔pyproject, not-already-published,
  changelog entry. PRs merged: the-forge#98, api#94, platform#68, aws#182,
  azure#74, ddata#59, dapi#74.
- **C4 npm**: `theforge-cli` untouched at 0.2.1 (only CHANGELOG formatting
  since tag) — no version bump without pertinent change (§7.9). Workflow
  already build-once + provenance-required + post-publish verify.
- **C6 keyboard nav**: roving tabindex + skip link + focus restore; modeled
  journey ~58→4 keys (≤10 asserted). Merged portal#55.
- **C7 graph guard**: blocked-tier manual layout never calls renderer;
  effectiveLayout substitution; thresholds from measured benchmarks.
  Merged portal#55.
- **C8 supply chain**: OIDC-only publish (no tokens), pinned actions,
  `id-token: write` scoped to publish job, immutable artifact binding,
  no `--force`/`skip-existing`/republish paths, attestations documented
  as future option.
- **C9 orchestration**: 7 release PRs (bump + 2.2.1 vendor + changelog)
  merged green after fixing: the-forge compat-matrix row, platform
  VALIDATION-RECEIPT rebind, doctor-api release-manifest (3 artifacts
  incl. SHA256SUMS, real hashes) + self-scan baseline re-record.
  Tags + GitHub Releases created for all 7.

## Incidents / residual gaps

1. **Verify-job index lag (flake class)**: publish→verify raced PyPI's
   simple-index propagation (JSON API live first). Packages confirmed
   installable manually ~90s later; 4/7 runs showed red verify despite
   successful publish. *Fix recommended*: verify job should poll
   `pypi.org/simple/<name>/` or retry pip install — follow-up PR pending.
2. **PyPI trusted publisher `environment: release`**: required operator
   re-registration on all 7 PyPI projects (done by user — publishes
   authenticated). `release` GitHub environment protection rules to be
   configured by owner (dispatch itself is already a manual gate).
3. **Attestations**: intentionally off; header comments in each
   publish-pypi.yml document re-enable path.
4. **forge-doctor-api portal**: not shipped in wheel (external-portal
   model) — consistent with its architecture; documented, not a defect.
5. **UX E2E**: key-count 4/10 is component-level modeled; a real-browser
   re-probe vs the original ~58-keypress journey is pending evidence.
6. forge-portal-app `package.json` exists (dev app, 0.1.0) — deliberately
   NOT published to npm (no independent use case).

## Certification

**CERTIFIED** — published artifacts verified == installed content ==
expected generation; clean-install matrix green; live telemetry and
security headers observed from the published package; all releases
OIDC-published with same-artifact integrity.

Residuals #1/#5 are verification-pipeline nits, not artifact defects.
