# Release dump schemas — Portal 2.2.1 Cycle 2

`scripts/release_dumps.py` emits sanitized, versioned-schema JSON artifacts for
release forensics. Every artifact is a JSON object whose `schema` field is a
versioned `forge/<Name>/<N>` identifier; any field change bumps `N`.

## Safety contract (all schemas, both modes)

- Default mode is `safe`. No environment variable values, cookies, session
  tokens, `Authorization` headers, or SSH keys are ever collected or written.
- Absolute user paths (`/home/<u>`, `/Users/<u>`, `<DRIVE>:\Users\<u>`) are
  rewritten to `<HOME>` before any byte reaches an artifact.
- Secret-shaped strings (token prefixes, `Bearer …`, `key=value` credential
  assignments) are replaced by `<REDACTED>`.
- `--mode extended` additionally records host attributes (`platform.node`,
  `platform.machine`) and CI **presence** signals (`"set"`/`"unset"` only —
  never values) and prints a stderr warning. Secrets remain excluded.
- No network calls. Anything that requires a registry lookup is reported as
  the literal string `"unresolved"` — never guessed.
- `--check` exits `1` when any emitted artifact records forbidden files,
  vendor drift, missing required members, or collector errors; `0` otherwise.
  Collector/usage errors exit `2`-style via argparse or a named `ERROR`
  status inside the artifact.

## `forge/ReleaseInventory/1` — `release-inventory.json`

Answers: *what code originated the package, which workflow produced it,
which version was published.*

| field | type | meaning |
|---|---|---|
| `schema` | string | `"forge/ReleaseInventory/1"` |
| `generated_at_utc` | string | ISO-8601 UTC timestamp, `Z` suffix |
| `mode` | string | `safe` \| `extended` |
| `repository.name` | string | checkout directory name |
| `repository.remote` | string\|null | `origin` URL, userinfo stripped |
| `commit.sha` | string\|null | `git rev-parse HEAD` (40-hex) |
| `commit.branch` | string\|null | current branch |
| `commit.dirty` | bool | working tree has uncommitted changes |
| `tag` | string\|null | tag exactly on HEAD, else `null` |
| `latest_tag` | string\|null | nearest reachable tag / newest `v*` tag |
| `package.name` | string\|null | from `package.json` or `pyproject.toml` |
| `package.version` | string\|null | source version |
| `package.ecosystem` | string | `npm` \| `python` \| `unresolved` |
| `package.source_file` | string\|null | which manifest supplied name/version |
| `workflow_file` | string\|null | first `publish`/`release` workflow basename |
| `workflow_path` | string\|null | `.github/workflows/<workflow_file>` |
| `workflows` | string[] | all workflow file names |
| `platform` | object | `system`, `release`, `python`, `implementation` (+ `node`, `machine` in extended) |
| `published_version` | string | always `"unresolved"` — registry queries are outside the offline boundary |
| `environment` | object | extended only: `ci_signals` name→`set`/`unset` |

## `forge/VendorIntegrity/1` — `vendor-integrity.json`

Answers: *is vendored content correct* — live files vs the manifest the
forge serves against, per sibling checkout under `--forges-dir`.

| field | type | meaning |
|---|---|---|
| `schema` | string | `"forge/VendorIntegrity/1"` |
| `forges_dir` | string | scanned parent dir (sanitized) |
| `source.server_sha256` | string | canonical `portal_core/forge_portal.py` hash |
| `source.telemetry_sha256` | string | canonical `portal_core/telemetry.py` hash |
| `forges.<name>.status` | string | `OK` \| `DRIFT` \| `NO_MANIFEST` \| `NOT_CHECKED_OUT` |
| `forges.<name>.drift` | bool | any divergence detected |
| `forges.<name>.manifest` | object | `path`, `present`, `sha256`, `schema`, `portal_version`, `file_count`, `parse_error` |
| `forges.<name>.server` | object | `sha256`, `matches_source` (vs canonical), `manifest_sha256`, `manifest_match` |
| `forges.<name>.telemetry` | object | same shape as `server` (expected bytes account for the vendored import rewrite) |
| `forges.<name>.assets` | object | `file_count`, `total_bytes`, `files` map (rel path → `sha256`,`bytes`), `missing`, `extra`, `mismatched` |
| `forges.<name>.forbidden` | object[] | forbidden scan over vendored paths (`path`, `reason`) |
| `summary` | object | `forges_known`, `checked_out`, `ok`, `drifted`, `not_checked_out` |
| `problems` | string[] | human-readable findings; non-empty fails `--check` |
| `status` | string | `OK` \| `FINDINGS` |

Drift = asset `missing`/`extra`/`mismatched`, server/telemetry hash mismatch
vs canonical source or manifest, missing expected module, or absent manifest
on a checkout that is expected to be vendored.

## `forge/WheelManifest/1` — `wheel-manifest.json`

Answers: *is the validated artifact the published one* — the recorded
`artifact.sha256` is the value to compare against the registry record.

| field | type | meaning |
|---|---|---|
| `schema` | string | `"forge/WheelManifest/1"` |
| `artifact` | object | `path` (sanitized), `name`, `present`, `sha256`, `bytes`, `kind` (`wheel`\|`sdist`) |
| `package` | object | METADATA/PKG-INFO highlights: `name`, `version`, `summary`, `license`, `requires_dist[]`, `entry_points` (section → `name = target` lines) |
| `files` | object[] | every member: `path`, `bytes`, `sha256` |
| `file_count`, `total_bytes` | int | member rollups |
| `required.<member>` | object | `expected`, `present`, `path`; members: `portal_index_html`, `_forge_portal.py`, `_portal_telemetry.py` |
| `forbidden` | object[] | forbidden member names **and** user-path/secret-shaped strings found inside `METADATA`/`PKG-INFO`/`WHEEL`/`entry_points.txt` |
| `problems` | string[] | findings list; non-empty fails `--check` |
| `status` | string | `OK` \| `FINDINGS` \| `ERROR` |

`--expect-portal` marks the three portal members required; a missing one is a
finding. Without it, presence is still reported but not required.

## `forge/NpmPackManifest/1` — `npm-pack-manifest.json`

Runs `npm pack --dry-run --json --ignore-scripts` in `--npm-dir` (no tarball
written, no lifecycle scripts) and records the declared file set.

| field | type | meaning |
|---|---|---|
| `schema` | string | `"forge/NpmPackManifest/1"` |
| `dir` | string | packaged directory (sanitized) |
| `package` | object | `name`, `version`, `filename`, `integrity`, `shasum`, `package_size`, `unpacked_size`, `total_files` |
| `files` | object[] | `path`, `bytes`, `mode` per packed file |
| `file_count`, `total_bytes` | int | rollups |
| `forbidden` | object[] | forbidden scan over packed paths |
| `status` | string | `OK` \| `FINDINGS` \| `ERROR` (npm missing / pack failed) |

## Forbidden list (all scans)

Basename globs (matched case-insensitively): `.env*`, `*id_rsa*`, `*.pem`,
`*token*`, `*secret*`, `*credential*`, `.DS_Store`. Directory segments
(case-insensitive): `.git/`, `__pycache__/`, `.pytest_cache/`,
`test-results/`. Content rules: absolute `/home/`,
`/Users/`, `C:\Users` paths inside archive metadata; secret-shaped strings.

The `*token*`-family patterns are intentionally over-broad (design-token
files trip them): a finding is a prompt for human review, not a verdict.

## `checksums.sha256` + `release-summary.md`

`checksums.sha256` holds `sha256sum`-format lines (`<hash>  <filename>`) for
every artifact in the output directory (excluding itself). `release-summary.md`
is the human-readable rollup of whatever artifacts were emitted in the run.

## Usage

```bash
# full bundle (defaults: artifacts/release/, forges dir = workspace parent)
python scripts/release_dumps.py all --check \
    --artifact dist/theforge_core-0.5.2-py3-none-any.whl --expect-portal \
    --npm-dir ../forge-cli

# single dumps
python scripts/release_dumps.py inventory --out artifacts/release
python scripts/release_dumps.py vendor --forges-dir .. --check
python scripts/release_dumps.py wheel --artifact pkg.whl --expect-portal
python scripts/release_dumps.py npm --npm-dir . --check
python scripts/release_dumps.py summarize   # rebuild summary + checksums
```
