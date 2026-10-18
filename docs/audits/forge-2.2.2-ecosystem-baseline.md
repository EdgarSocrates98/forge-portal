# Cycle 2.2.2 — Ecosystem Baseline Audit

Date: 2026-10-18 · Auditor: Devin (session) + independent read-only subagent · Scope: all 9 `main` branches + public registries.

## Environment

| Tool | Version / status |
|---|---|
| Python | 3.12.3 (`/usr/bin/python3`), pip 24.0 |
| Node / npm | v22.23.2 / 10.9.8 |
| gh | 2.102.0, authenticated as `EdgarSocrates98` (repo, workflow, gist, read:org; SSH git) |
| Browser | `google-chrome`/`google-chrome-stable` present; `DISPLAY=:0`, Wayland |
| Playwright | installed ad hoc (`1.x`, pip); bundled Chromium **not** installed (no sudo for `--with-deps`) — system Chrome used via `channel="chrome"` |
| Orca | `/usr/bin/orca` present |
| Network | PyPI, npm, GitHub all HTTP 200 |
| NVDA / VoiceOver | unavailable on this Linux host → `NOT_TESTED` |

## Repository state (all on `main`, clean)

| Repo | HEAD | Local ver | Latest tag | GH release | Registry | Published |
|---|---|---|---|---|---|---|
| the-forge | b8df4ac | 0.5.2 | v0.5.2 | v0.5.2 | `theforge-core` 0.5.2 | ✓ |
| api-forge | 891ffc2 | 0.1.2 | v0.1.2 | v0.1.2 | `apiforge-af` 0.1.2 | ✓ |
| spark-forge-aws | 12913ad | 0.5.2 | v0.5.2 | v0.5.2 | `sparkforge-aws` 0.5.2 | ✓ |
| spark-forge-azure | 7b13ed0 | 0.1.2 | v0.1.2 | v0.1.2 | `sparkforge-azure` 0.1.2 | ✓ |
| platform-forge | 25de19a | 0.1.2 | v0.1.2 | v0.1.2 | `platformforge` 0.1.2 | ✓ |
| forge-doctor-data | a447dfa | 1.0.2 | v1.0.2 | v1.0.2 | `forge-doctor-data` 1.0.2 | ✓ |
| forge-doctor-api | 9eec90d | 0.2.2 | v0.2.2 | v0.2.2 | `forge-doctor-api` 0.2.2 | ✓ |
| forge-cli | 114cadf | 0.2.1 | v0.2.1 | v0.2.1 | `theforge-cli` 0.2.1 (npm, dist-tag `latest`) | ✓ |
| forge-portal | 4250556 | 0.1.0 | v0.1.0 | v0.1.0 | not published (`private: true`) | n/a |

All published versions match local metadata and tags. Registry histories are linear (no skipped/yanked versions observed).

## Post-release commits (HEAD vs tag)

Several repos have commits after their release tag — all verified as non-artifact changes:

- `the-forge` b8df4ac — docs only.
- `api-forge` 891ffc2 — CI workflow changes.
- `spark-forge-aws` 12913ad — `fix(release): sync manifest versions with package 0.5.2`: fixed `manifest.json` + `.claude-plugin/plugin.json` (0.5.0 → 0.5.2). **Verified: neither file is shipped in the published wheel** (1045 entries checked; repo-root manifests absent). The published artifact is correct; no re-publish needed.
- `spark-forge-azure`, `platform-forge`, `forge-doctor-data`, `forge-doctor-api` — CI/verification improvements (PyPI propagation retries).
- `forge-cli` 114cadf — the v0.2.1 release bump commit itself.
- `forge-portal` — docs.

## CI / workflow state at audit time

- `spark-forge-aws` publish-pypi run 39135176895 **failed** 14:15Z — post-publish verify: PyPI JSON API showed 0.5.2 live, but `pip install` saw only `0.5.0, 0.5.1` (simple-index propagation lag). Subsequent commits added `pip install` retry/backoff. Root cause understood; transient.
- `platform-forge` publish-pypi 39135186140 — same propagation lag; later runs green.
- `forge-cli` `release` workflow 39116972588 **failed** at "GitHub Release (tarball)" step on the v0.2.1 bump; publish-npm 39117484568 succeeded at 09:59 and `theforge-cli@0.2.1` + GH release exist. See `docs/security/publishing-workflow-review.md` — this workflow is itself the P1 finding.
- `forge-doctor-api`: 7 open PRs, all Dependabot chores (ruff, pyyaml, actions/*, mcp) — none blocking.
- All other latest runs: green.

## Phase 0 verdict

Baseline is coherent: every public version exists in registry, tag, and release; no divergent tags; post-release deltas are CI/docs/repo-manifest only. Known CI scar (PyPI index propagation) already mitigated in-tree. **No P0 baseline issues.**

Open questions recorded (not decided): whether `theforge-*-adapter` dists should publish to PyPI; whether `SIBLING_REPOS_TOKEN`/`APIFORGE_PR_TOKEN` are least-privilege (token scope lives in repo settings, not verifiable from code).
