# Cycle 2.2.2 — Ecosystem Independence Validation

Claims verified against installed dist metadata, source trees, and live CLI behavior.

## Dependency graph (published artifacts)

| Package | Runtime deps | Depends on another Forge? | Needs Node? |
|---|---|---|---|
| theforge-core | **0 deps** (stdlib-only) | — | no |
| apiforge-af | pydantic, typer, PyYAML, tree-sitter*, python-hcl2, graphql-core, cryptography | **no** | no |
| sparkforge-aws | PyYAML, jsonschema | **no** | no |
| sparkforge-azure | PyYAML, jsonschema | **no** | no |
| platformforge | PyYAML, jsonschema, python-hcl2 | **no** | no |
| forge-doctor-data | typer, rich, packaging | **no** | no |
| forge-doctor-api | typer, rich, PyYAML | **no** | no |
| theforge-cli | @clack/prompts, execa, figlet, picocolors | **no** | (it is the node tool) |

## Independence checks — all verified

- **Each Forge runs individually**: every venv installed *only* its own package (plus public libs) and produced a working `--version`/`--help` — no sibling needed. ✓
- **The Forge is optional**: `theforge-core` is depended on by *nothing* in the registry set; specialists run without it. ✓
- **Forge CLI works alone**: `forge-cli list`/`doctor` ran in a clean npm dir — the doctor ran **offline**, no forge checkouts present, still produced `forge-health/v1` output. ✓
- **Forge Portal is not a prerequisite**: all CLIs work with no portal; portal is `private: true`, not a dep anywhere. ✓
- **No Node at runtime for Python Forges**: zero npm/node requirement in any pyproject. ✓
- **No circular imports**: specialists → core/each other = **0 hits** in `src/`; the-forge core imports no specialist; adapters→specialists only (one direction). Graph is a **DAG**: adapters → specialists → nothing. ✓
- **No hidden checkout deps**: all imports resolved inside `/tmp` venv site-packages; `in_checkout=false` for all 7. spark-forge-azure's `test_protocol_apiforge_compat.py` runs `from apiforge.contracts …` in a subprocess against a sibling checkout — **skipped when absent**, a test-only convenience, not a package dep. ✓
- **No fabricated cross-project data**: packages vendor their own `_installkit`/`_forge_portal`/`_portal_telemetry` copies (drift-checked via `_SOURCE_SHA256` headers); portal adapters exchange contract docs (`forge/PortalEvent/1`, `forge/HealthDoc/v1`, `forge/InstallationStatus/v1`), not fabricated state. ✓
- **Identifiers/contracts**: events carry `schema` + `correlation_id` + real timestamps; capabilities declare `supported|unverified|unsupported` honestly; installations manifest via `forge/InstallationManifest/v1`. ✓

## Co-installation note

The contract is **isolation**, not co-installation — the prompt forbids forcing artificial co-install. Compatible-by-construction verified (shared deps use overlapping non-conflicting bands; no package pins a conflicting version). A single-venv all-seven co-install was not asserted as a gate.

## Residual gap

- **R-1 (P2)**: full federated runtime — Portal driven by *installed* sibling packages end-to-end (not the stub adapter) — was not exercised this cycle. The portal↔forge contract is proven via the vendored `PortalServer` path; live federation against the 7 wheels is a flagged residual for the freeze checklist.

## Verdict

**PASS** — the ecosystem is a DAG of independently installable, independently runnable packages; nothing requires The Forge, the CLI, the Portal, or Node at Python runtime.
