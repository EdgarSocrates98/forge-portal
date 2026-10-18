# Cycle 2.2.2 — Public-Package E2E Report

Covers end-to-end consumer behavior: install → execute → produce contract artifacts, all from published packages. Evidence raw files under `docs/audits/forge-2.2.2-dump/`.

## 1. Isolated installs (PyPI)

All 7 wheels installed clean in dedicated venvs with `--index-url https://pypi.org/simple` only — no fallback index, no local paths. See `public-package-runtime-matrix.md` for the per-package matrix. **7/7 PASS.**

## 2. Console scripts (real executions, cwd outside checkouts)

| Command | Result |
|---|---|
| `forge --version` | `theforge 0.5.2` |
| `apiforge --version` / `--help` | rc=0, full typer help |
| `sparkforge-aws --version` / `--help` | `0.5.2`, full verb tree |
| `sparkforge-azure --version` | `0.1.2` |
| `platformforge --version` | `0.1.2` |
| `forge-doctor-data --version` | `1.0.2` |
| `forge-doctor-api --version` | `0.2.2` |

## 3. npm consumer (`theforge-cli@0.2.1`)

Clean `npm init` dir → `npm install theforge-cli@0.2.1` (33 deps) → `node_modules/.bin/forge-cli`:

- `--version` → `forge-cli 0.2.1` ✓
- `--help` → full usage (interact/`--all`/`--only`/`--plan`/`doctor`/`list`/`install`/`clone`/`update`) ✓
- `list` → renders 9-Forge catalog with per-forge "nunca executado" state ✓
- `doctor` → offline health model `forge-health/v1`, 88/100, evidence lines per check ✓
- Bin name is `forge-cli` (package name `theforge-cli`). `npx theforge` 404s by design — **doc note**: users must invoke `forge-cli`, not the dist name. Recorded as P2 doc fix.

## 4. Portal runtime path (public artifact → served bundle)

`forge-portal` is not registry-published (`private: true`); its distributable is the GH release + the built `dist/` bundle. Verified: `npm run build` → `dist/forge-portal-app/browser`; served by the vendored `portal_core.forge_portal.PortalServer` with a stub `PortalAdapter`; real executions produced through `POST /api/v1/tasks/plan` + `/tasks/execute` (emitted `operation.start/end`, `task.planned/started/finished`, `receipt.issued` events with `forge/PortalEvent/1` schema + real timestamps). The Execution Studio page rendered 17 timeline rows from that stream — the same path exercised by the keyboard E2E (`execution-keyboard-validation.md`).

## 5. Telemetry / manifests / read-only safety

- `forge-cli doctor` ran **fully offline** (no outbound calls; its evidence lines confirm `system.offline.capable` OK).
- Package introspection used `importlib.metadata` against the venv — no writes outside the venv, no `$HOME` mutation beyond pip cache (disabled via `--no-cache-dir`).
- Execution events carried `schema: forge/PortalEvent/1`, ISO timestamps, correlation ids — the recorded-only contract holds (inspector shows fields verbatim, unrecorded relations are absent, not guessed — see inspector dump in `keyboard-e2e-evidence.json`).

## 6. Cross-package co-install smoke

All 7 Python packages share only mainstream deps (PyYAML/jsonschema/pydantic/typer/rich…). Version bands do not conflict; the matrix venvs resolved independently. Forced co-installation of all seven in one venv is **not** an ecosystem requirement (Phase 9 documents isolation as the contract), so it was not asserted as a gate.

## Verdict

**PASS** for publishable artifacts; **PARTIAL** for portal runtime depth (stub-adapter path proven end-to-end including real event production; full sibling-forge federation against installed packages not exercised this cycle — see `ecosystem-independence-validation.md` residual gap R-1).
