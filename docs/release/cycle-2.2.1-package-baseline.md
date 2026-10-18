# Cycle 2.2.1 — Package Baseline Audit

Date: 2026-02-13 · Program: `prompt_evo_portal2.3.md` (Portal 2.2.1 release readiness)

## Registry vs source vs installed generation

Evidence: PyPI JSON API (`pypi.org/pypi/<name>/json`), `npm view`, wheel
inspection of `theforge-core==0.5.1` (44-file set? → measured **42 portal
assets, zero `_portal_telemetry.py`** → **2.1 generation** while source
carries 44 assets + telemetry = 2.2).

| Projeto | Main SHA | Versão fonte | Versão registro | Vendored (src) | Wheel/tarball | Status |
|---|---|---|---|---|---|---|
| the-forge (`theforge-core`) | 012a40d | 0.5.1 | 0.5.1 | 2.2 (44 assets + telemetry) | 2.1 (42 assets, no telemetry) | **OUTDATED** |
| api-forge (`apiforge-af`) | 95e4169 | 0.1.1 | 0.1.1 | 2.2 | presumed 2.1 (same publish wave) | **OUTDATED** |
| platform-forge (`platformforge`) | 347567c | 0.1.1 | 0.1.1 | 2.2 | presumed 2.1 | **OUTDATED** |
| spark-forge-aws (`sparkforge-aws`) | 020f566 | 0.5.1 | 0.5.1 | 2.2 | presumed 2.1 | **OUTDATED** |
| spark-forge-azure (`sparkforge-azure`) | 1ea1875 | 0.1.1 | 0.1.1 | 2.2 | presumed 2.1 | **OUTDATED** |
| forge-doctor-data | f934c5d | 1.0.1 | 1.0.1 | 2.2 | presumed 2.1 | **OUTDATED** |
| forge-doctor-api | 06dff0c | 0.2.1 | 0.2.1 | 2.2 | presumed 2.1 | **OUTDATED** |
| forge-cli (`theforge-cli`) | 4410523 | 0.2.1 | 0.2.1 | n/a | 0.2.1 | CURRENT (no pertinent change → keep version per §7.9) |
| forge-portal | 30194ed | n/a | n/a | canonical 2.2 | vendored only | CURRENT |

## Publish workflow inventory

All 7 Python repos have `publish-pypi.yml` (OIDC trusted publishing,
`id-token: write`, pinned `pypa/gh-action-pypi-publish@dc37677`). Gap vs
Cycle 3 requirements: **build and publish share one job** (rebuilds on
publish), no version/tag/pre-published gate, no post-publish smoke, no
protected `environment:` declared in-file. forge-cli has
`publish-npm.yml` (OIDC + single-tarball flow — audited Cycle 11.2,
preserve).

## Divergences

- Published artifacts lag the certified 2.2 vendored generation → new
  patch releases required (+0.0.1 each).
- `ecosystem-compatibility.json` pins the previous combination; refresh
  after the new round.
- forge-portal has tag v0.1.0 but is not registry-published (vendored
  distribution only — intended).

## Open questions (human boundary)

- PyPI Trusted Publisher config on pypi.org is external state — assumed
  working since the 0.x.1 round published via OIDC successfully.
- npm `theforge-cli` version stays 0.2.1 unless CLI source changed since
  tag v0.2.1 (checked during Cycle 4).
