# Portal 2.2 — vendor matrix

Measured against `main` working trees of all seven sibling checkouts on
2026-10-18. All values are fresh `sha256sum` measurements, not historical.
Updated at Cycle 6: re-vendor brought the Cycle 3–5 frontend generation
(44 files) to every forge — an earlier revision of this matrix recorded
the 2.1-generation 42-file bundle `449eb96b4e449bb5`.

## Server generation parity

Canonical source: `portal_core/forge_portal.py`
`sha256 = a6bbc5f518d69537…` (post-#47 `timezone.utc` generation)

| Forge | Vendored path | State |
|---|---|---|
| the-forge | `src/theforge/_forge_portal.py` | MATCH |
| api-forge | `src/apiforge/_forge_portal.py` | MATCH |
| platform-forge | `platformforge/_forge_portal.py` | MATCH |
| spark-forge-aws | `sparkforge_aws/_forge_portal.py` | MATCH |
| spark-forge-azure | `sparkforge_azure/_forge_portal.py` | MATCH |
| forge-doctor-data | `src/forge_doctor_data/_forge_portal.py` | MATCH |
| forge-doctor-api | `scripts/_forge_portal.py` | MATCH |

## Telemetry parity

Canonical source: `portal_core/telemetry.py`
`sha256 = 0d7ce7ada357327b…` — vendored with import rewrite
(`import forge_portal` → `from <pkg> import _forge_portal`, flat for
forge-doctor-api). All seven targets report `telemetry: parity ok`.

## Asset bundle parity

Canonical build: `dist/forge-portal-app/browser` — content hash over 44
files `052a06e25361d140` (recursive sha256 over `name + bytes`). The 44th
files are the Cycle 3–5 graph/execution/a11y chunks absent from the 2.1
generation (42 files, `449eb96b4e449bb5`).

| Forge | Asset dir | Files | State |
|---|---|---|---|
| the-forge | `portal/assets` | 44 | MATCH |
| api-forge | `portal/assets` | 44 | MATCH |
| platform-forge | `portal/assets` | 44 | MATCH |
| spark-forge-aws | `portal/assets` | 44 | MATCH |
| spark-forge-azure | `portal/assets` | 44 | MATCH |
| forge-doctor-data | `src/forge_doctor_data/portal_assets` | 44 | MATCH |
| forge-doctor-api | `portal/assets` | 44 | MATCH |

## Manifest hardening (Cycle 1 change)

`scripts/vendor.py` records the generations inside
`portal/manifest.json`:

- `server_sha256` / `server_generation`
- `telemetry_sha256` / `telemetry_generation`
- per-asset hashes and byte sizes

Each manifest is self-describing — any consumer can compare hashes
against the files on disk without a lookup table.

`python scripts/vendor.py --check` passes clean (exit 0): all seven
forges report `server: byte-parity ok`, `telemetry: parity ok` and
`assets: manifest unchanged (44 files)`.

## Compatibility coverage

`tests/test_compat_generations.py` (11 tests, all passing) exercises the
generation-mismatch contract over real HTTP:

- old-generation adapter (no new ops) still serves envelope/session/health;
- missing optional capability → `PORTAL-UNSUPPORTED` 404, never a 500;
- adapter-declared capabilities surface in `GET /capabilities` fallback;
- custom ops coexist with default ops across generations.

## Forge independence

Vendoring remains copy-time only: each forge ships `_forge_portal.py` +
`_portal_telemetry.py` + `portal/assets/` inside its own distribution.
No runtime import of `portal_core`, no path back to this checkout.
