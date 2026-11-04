# Release diagnostic summary

Generated: 2026-11-04T21:09:49Z \xb7 mode: `safe`

Safety: no env var values, cookies, tokens, Authorization headers or SSH keys are collected; user paths appear as `<HOME>`; secret-shaped strings appear as `<REDACTED>`.

## Inventory \u2014 `forge/ReleaseInventory/1`

- repository: `forge-portal` @ `340b01a263e2` (branch `main`, dirty=True)
- tag on HEAD: `none` \xb7 latest tag: `v1.1.0`
- package: `forge-portal-app` 1.1.1 (npm)
- workflow: `none`
- published_version: `unresolved` \u2014 registry lookups are outside the offline boundary; compare `commit.sha` and `package.version` against the registry record externally

## Vendor integrity \u2014 `forge/VendorIntegrity/1`

Forges dir: `E:\projetos\FORJAS` \xb7 8/8 checkouts \xb7 8 OK \xb7 0 drifted

| forge | status | files | missing | extra | mismatched |
|---|---|---|---|---|---|
| api-forge | OK | 66 | 0 | 0 | 0 |
| forge-doctor-api | OK | 66 | 0 | 0 | 0 |
| forge-doctor-data | OK | 66 | 0 | 0 | 0 |
| platform-forge | OK | 66 | 0 | 0 | 0 |
| product-forge | OK | 66 | 0 | 0 | 0 |
| spark-forge-aws | OK | 66 | 0 | 0 | 0 |
| spark-forge-azure | OK | 66 | 0 | 0 | 0 |
| the-forge | OK | 66 | 0 | 0 | 0 |

## npm pack \u2014 `forge/NpmPackManifest/1`

- dir: `.`
- package: `forge-portal-app` 1.1.1 (integrity `sha512-7M+fG1su9guQcKLu5FOujolVnF1kL7T8Z40lt+jpAdERoPEESbLQaTtxL9mjec8Vg870F/UwFjeSWE5uREU1DA==`)
- members: 1198 files, 96566628 bytes unpacked
- forbidden findings: 0
- status: OK

_`wheel-manifest.json` not collected in this run._

## Integrity

`checksums.sha256` covers every emitted artifact in this directory.
