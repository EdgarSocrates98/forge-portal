# Cycle 2.2.2 — Publishing Workflow Security Review

Method: independent read-only audit of every `.github/workflows/*.yml` + release scripts across the 8 publishing repos, cross-checked against live run logs (`gh run view`). Verdict per prompt §8 checklist.

## A. Shared PyPI template (7 repos) — `publish-pypi.yml`

Byte-identical template (201 lines, only `PKG_NAME`/console-script differ):

| Control | Status |
|---|---|
| Trusted Publishing / OIDC | **PASS** — `id-token: write` scoped to the `publish` job only; workflow-level `contents: read`; `pypa/gh-action-pypi-publish` SHA-pinned; **no PYPI_TOKEN anywhere** |
| Environment | **PASS** — `environment: release` on publish job (GitHub-side protection is repo settings, flagged for human confirm) |
| Version/branch gates | **PASS** — dispatch input == `pyproject` version, PyPI 404-vs-exists check, CHANGELOG gate; **gap**: no git-tag↔version check (P2) |
| Build-once/publish-same | **PASS** — `build` uploads artifact; `publish` downloads + `sha256sum --check` before publish |
| Post-publish verify | **PASS** — PyPI JSON poll 20×15s, then clean-venv `pip install ==exact` 10×30s retry, then CLI `--version` smoke |
| Attestations | documented **off**, with the exact 2-line enablement in the header |
| Failure handling | version-exists → fail-closed; network/index lag → retried then hard-fail; no silent fallback, no index bypass, no real publish during tests |
| Minor | no `concurrency:` group (second dispatch fails safe at PyPI anyway); `persist-credentials` default on the build checkout |

### Per-repo extras

- **the-forge**: `release-gates.yml` adds sdist→wheel file-parity gate, SHA256SUMS, contract regen diff, wheel smoke, `theforge` absence from specialist wheels, pip-audit + CycloneDX SBOM, `persist-credentials: false` everywhere. `release-compat.yml`/`ecosystem-real.yml`/`provider-surface-drift.yml` check out siblings at dispatch-input refs via `SIBLING_REPOS_TOKEN || github.token` — needs **least-privilege confirmation** (recorded open question).
- **api-forge**: `change-control-pages.yml` publishes GitHub Pages (not packages); `ci.yml` has PAT-gated auto-merge (`APIFORGE_PR_TOKEN`, `vars.APIFORGE_AUTO_MERGE`) — note, not a publish path.
- **spark-forge-aws**: `release.yml` = manual-only; tag↔`__version__` gate; `verify_wheel.py` double-build + sha256 parity + clean-venv install + 539 tests + twine; CycloneDX SBOM; **draft** GH release only.
- **forge-doctor-data**: `release.yml` dispatch-on-tag → `verify_release.py` + pytest + poetry build + RC (SBOM, SHA256SUMS, in-toto-lite provenance).
- **forge-doctor-api**: `release.yml` — the only repo emitting `actions/attest-build-provenance` on dist; SBOM + sha256sums verify; draft release.

## B. npm — `theforge-cli`

### `publish-npm.yml` (primary) — **PASS, strongest pipeline in the fleet**

`id-token: write` job-scoped + `environment: npm`; branch gate = `main`; npm ≥11.5.1 enforced for OIDC; `verify-version.mjs` (SemVer + lock match + tag→HEAD + `--expect-sha` anti-TOCTOU + exists-refusal); `npm pack` tarball uploaded once; publish job re-checks out the validated SHA, enforces exactly-one tarball, `npm publish --provenance`; post-publish polls 18×10s, **attestation presence is a hard fail**, remote `dist.integrity` == local sha512, clean-dir `npm install` + `--help` smoke.

### `release.yml` (parallel path) — **P1 FINDING**

- Trigger `push: tags v*`; top-level `id-token: write` (**workflow-wide**), no `environment:`.
- Publishes with **long-lived `secrets.NPM_TOKEN`** — a complete bypass of the OIDC/environment flow; silently skipped only if unset.
- `npm publish` repacks the working tree — **not** the byte-identical artifact attached to the GH release; no integrity cross-check; **no post-publish verify**.
- Observed failing at "GitHub Release (tarball)" on the v0.2.1 bump (run 39116972588) — the gate ordering allowed `publish-npm.yml` to succeed while this path erred.

**Recommendation (recorded, not applied — needs owner decision):** strip the `npm publish` step from `release.yml` (make it GH-release-only), or gate it behind `environment: npm` + the same artifact binding as `publish-npm.yml`.

## C. Historical failures inspected

- `sparkforge-aws`/`platformforge` publish runs failed 14:15Z on **PyPI simple-index propagation lag** (JSON live, pip index stale) — already mitigated in-tree by pip-install retry commits. Not a pipeline defect at HEAD.
- `forge-cli publish-npm` earlier failures were pre-fix; latest run green with provenance + integrity check.

## Verdict

PyPI fleet: **PASS**. npm primary path: **PASS**. **P1 residual**: `forge-cli/release.yml` long-lived-token publish path. P2: tag↔version gate missing from the PyPI template; confirm `SIBLING_REPOS_TOKEN`/`APIFORGE_PR_TOKEN` scopes; confirm GitHub `release`/`npm` environment protection rules exist server-side.
