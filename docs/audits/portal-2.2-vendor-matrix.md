# Portal 2.2 — Cycle 1 vendor matrix

Measured against `main` working trees of all seven sibling checkouts on
2026-10-19. All values are fresh `sha256sum` measurements, not historical.

## Server generation parity

Canonical source: `portal_core/forge_portal.py`
`sha256 = 4186cebd6201eb93…` (1159 lines)

| Forge | Vendored path | sha256 (16) | State |
|---|---|---|---|
| the-forge | `src/theforge/_forge_portal.py` | `4186cebd6201eb93` | MATCH |
| api-forge | `src/apiforge/_forge_portal.py` | `4186cebd6201eb93` | MATCH |
| platform-forge | `platformforge/_forge_portal.py` | `4186cebd6201eb93` | MATCH |
| spark-forge-aws | `sparkforge_aws/_forge_portal.py` | `4186cebd6201eb93` | MATCH |
| spark-forge-azure | `sparkforge_azure/_forge_portal.py` | `4186cebd6201eb93` | MATCH |
| forge-doctor-data | `src/forge_doctor_data/_forge_portal.py` | `4186cebd6201eb93` | MATCH |
| forge-doctor-api | `scripts/_forge_portal.py` | `4186cebd6201eb93` | MATCH |

## Asset bundle parity

Canonical build: `dist/forge-portal-app/browser` — content hash over 42
files `449eb96b4e449bb5` (recursive sha256 over `name + bytes`).

| Forge | Asset dir | Content hash | Files | State |
|---|---|---|---|---|
| the-forge | `portal/assets` | `449eb96b4e449bb5` | 42 | MATCH |
| api-forge | `portal/assets` | `449eb96b4e449bb5` | 42 | MATCH |
| platform-forge | `portal/assets` | `449eb96b4e449bb5` | 42 | MATCH |
| spark-forge-aws | `portal/assets` | `449eb96b4e449bb5` | 42 | MATCH |
| spark-forge-azure | `portal/assets` | `449eb96b4e449bb5` | 42 | MATCH |
| forge-doctor-data | `src/forge_doctor_data/portal_assets` | `449eb96b4e449bb5` | 42 | MATCH |
| forge-doctor-api | `portal/assets` | `449eb96b4e449bb5` | 42 | MATCH |

## Manifest hardening (Cycle 1 change)

`scripts/vendor.py` now records the server generation inside
`portal/manifest.json`:

- `server_sha256` — full sha256 of the vendored `_forge_portal.py`
- `server_generation` — first 16 hex chars, the human-facing generation id

This closes a detection gap: previously the manifest only covered asset
files, so a stale `_forge_portal.py` was only detectable by external hash
comparison (the-forge's `test_independence.py` `KNOWN_PREV_GENERATIONS`
allowance). Now each forge's manifest is self-describing — any consumer can
compare `server_sha256` against the file on disk without a lookup table.

`python scripts/vendor.py --check` passes clean (exit 0) after re-vendor:
all seven forges report `server: byte-parity ok` and
`assets: manifest unchanged (42 files)`.

## Compatibility coverage

`tests/test_compat_generations.py` (11 tests, all passing) exercises the
generation-mismatch contract over real HTTP:

- old-generation adapter (no new ops) still serves envelope/session/health;
- missing optional capability → `PORTAL-UNSUPPORTED` 404, never a 500;
- adapter-declared capabilities surface in `GET /capabilities` fallback;
- custom ops coexist with default ops across generations.

## Forge independence

Vendoring remains copy-time only: each forge ships `_forge_portal.py` +
`portal/assets/` inside its own distribution. No runtime import of
`portal_core`, no path back to this checkout.
