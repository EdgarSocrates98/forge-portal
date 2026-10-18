# Cycle 2.2.2 — Version Consistency Matrix

Sources compared per project: `pyproject.toml`/`package.json` version, package `__version__`/runtime `--version`, repo manifests (`manifest.json`, `.claude-plugin/plugin.json`), git tag, GitHub release, public registry latest.

| Project | Metadata | Runtime (installed) | Repo manifests | Tag | GH release | Registry | Consistent |
|---|---|---|---|---|---|---|---|
| the-forge | 0.5.2 | `theforge 0.5.2` | ✓ | v0.5.2 | v0.5.2 | 0.5.2 | **PASS** |
| api-forge | 0.1.2 | 0.1.2 | ✓ | v0.1.2 | v0.1.2 | 0.1.2 | **PASS** |
| spark-forge-aws | 0.5.2 | 0.5.2 | ✓ (post-release fix 12913ad) | v0.5.2 | v0.5.2 | 0.5.2 | **PASS**¹ |
| spark-forge-azure | 0.1.2 | 0.1.2 | ✓ | v0.1.2 | v0.1.2 | 0.1.2 | **PASS** |
| platformforge | 0.1.2 | 0.1.2 | ✓ | v0.1.2 | v0.1.2 | 0.1.2 | **PASS** |
| forge-doctor-data | 1.0.2 | 1.0.2 | ✓ | v1.0.2 | v1.0.2 | 1.0.2 | **PASS** |
| forge-doctor-api | 0.2.2 | 0.2.2 | ✓ | v0.2.2 | v0.2.2 | 0.2.2 | **PASS** |
| theforge-cli | 0.2.1 (`package.json` + lock) | `forge-cli 0.2.1` | n/a | v0.2.1 | v0.2.1 | 0.2.1 (`latest`) | **PASS** |
| forge-portal | 0.1.0 (`package.json`) | n/a | n/a | v0.1.0 | v0.1.0 | unpublished | **PASS** |

¹ spark-forge-aws: `manifest.json` + `.claude-plugin/plugin.json` lagged at 0.5.0 on the v0.5.2 tag; commit `12913ad` synced them to 0.5.2 on main. Those files are **not shipped in the wheel**, so the published artifact was never inconsistent — this was a repo-internal version gate miss, now closed.

## Existing gates found in-tree

- spark-forge-aws test `test_every_manifest_declares_the_same_version` (pyproject + `__init__` + `manifest.json` + `plugin.json` must agree) — the gate that caught the sfaws miss.
- forge-cli `scripts/release/verify-version.mjs` — SemVer + package.json/lock match + tag→HEAD + `--expect-sha` anti-TOCTOU + npm `version-exists` refusal.
- forge-doctor-data `tools/verify_release.py` — tag↔version↔dist coherence.
- the-forge `release-gates.yml` — ecosystem manifest check + RC lifecycle receipts.

## Residual gap (P2)

The **shared PyPI publish template** (7 repos) gates input↔pyproject↔CHANGELOG↔PyPI-existence but **does not verify a git tag ↔ version relation** — a tag is neither required nor checked against the published version (unlike forge-cli/doctor-data). Recommendation: add the tag check to the template (or document the tagless-dispatch policy). Recorded, not implemented — policy decision.
