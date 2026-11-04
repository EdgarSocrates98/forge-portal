# Release diagnostic summary

Generated: 2026-11-04T07:51:04Z \xb7 mode: `safe`

Safety: no env var values, cookies, tokens, Authorization headers or SSH keys are collected; user paths appear as `<HOME>`; secret-shaped strings appear as `<REDACTED>`.

## Inventory \u2014 `forge/ReleaseInventory/1`

- repository: `forge-portal` @ `d325a6271aeb` (branch `main`, dirty=False)
- tag on HEAD: `none` \xb7 latest tag: `v1.1.0`
- package: `forge-portal-app` 1.1.0 (npm)
- workflow: `none`
- published_version: `unresolved` \u2014 registry lookups are outside the offline boundary; compare `commit.sha` and `package.version` against the registry record externally

## Vendor integrity \u2014 `forge/VendorIntegrity/1`

Forges dir: `..` \xb7 8/8 checkouts \xb7 8 OK \xb7 0 drifted

| forge | status | files | missing | extra | mismatched |
|---|---|---|---|---|---|
| the-forge | OK | 66 | 0 | 0 | 0 |
| spark-forge-aws | OK | 66 | 0 | 0 | 0 |
| spark-forge-azure | OK | 66 | 0 | 0 | 0 |
| api-forge | OK | 66 | 0 | 0 | 0 |
| platform-forge | OK | 66 | 0 | 0 | 0 |
| forge-doctor-data | OK | 66 | 0 | 0 | 0 |
| forge-doctor-api | OK | 66 | 0 | 0 | 0 |
| product-forge | OK | 66 | 0 | 0 | 0 |

## npm pack \u2014 `forge/NpmPackManifest/1`

- dir: `.`
- package: `forge-portal-app` 1.1.0 (integrity `sha512-pojIIq5uZReEieWAPjyyuOSb6lGJgmDr50FLMgj3ZOpa+9xPZ9u5bFshm645Fr1hQVy1zTdNCn+hqWUmwooRSA==`)
- members: 742 files, 53040472 bytes unpacked
- forbidden findings: 0
- status: OK

_`wheel-manifest.json` not collected in this run._

## Integrity

`checksums.sha256` covers every emitted artifact in this directory.
