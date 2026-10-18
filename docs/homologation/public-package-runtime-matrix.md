# Cycle 2.2.2 — Public-Package Runtime Matrix

Method: each package installed into a **fresh venv** (`--no-cache-dir --index-url https://pypi.org/simple`, cwd `/tmp`, `PYTHONPATH`/`PIP_INDEX_URL` scrubbed). Import resolved inside site-packages of the venv — never a checkout. Evidence JSON: `docs/audits/forge-2.2.2-dump/phase1-install-results.json`.

| Package | Version | Install | Import path | `__version__` = dist | Console script | `--version` | `--help` | In checkout? |
|---|---|---|---|---|---|---|---|---|
| theforge-core | 0.5.2 | PASS | `/tmp/forge-222/env-theforge-core/venv/.../theforge` | ✓ 0.5.2 | `forge` | `theforge 0.5.2` | rc=0 | no |
| apiforge-af | 0.1.2 | PASS (1 transient retry¹) | `.../env-apiforge-af/venv/.../apiforge` | ✓ 0.1.2 | `apiforge` | rc=0 | rc=0 | no |
| sparkforge-aws | 0.5.2 | PASS | `.../env-sparkforge-aws/venv/.../sparkforge_aws` | ✓ 0.5.2 | `sparkforge-aws` | `sparkforge-aws 0.5.2` | rc=0 | no |
| sparkforge-azure | 0.1.2 | PASS | `.../env-sparkforge-azure/venv/.../sparkforge_azure` | ✓ 0.1.2 | `sparkforge-azure` | `sparkforge-azure 0.1.2` | rc=0 | no |
| platformforge | 0.1.2 | PASS | `.../env-platformforge/venv/.../platformforge` | ✓ 0.1.2 | `platformforge` | `platformforge 0.1.2` | rc=0 | no |
| forge-doctor-data | 1.0.2 | PASS | `.../env-forge-doctor-data/venv/.../forge_doctor_data` | ✓ 1.0.2 | `forge-doctor-data` | `forge-doctor-data 1.0.2` | rc=0 | no |
| forge-doctor-api | 0.2.2 | PASS | `.../env-forge-doctor-api/venv/.../forge_doctor_api` | ✓ 0.2.2 | `forge-doctor-api` | `forge-doctor-api 0.2.2` | rc=0 | no |
| theforge-cli (npm) | 0.2.1 | PASS (`npm install` in clean dir) | `node_modules/theforge-cli` | ✓ 0.2.1 | `forge-cli` bin | `forge-cli 0.2.1` | full help renders | no |

¹ First `pip install apiforge-af` hit a transient resolver blip — `cryptography<51,>=50` reported "from versions: none" while cryptography 50.0.2 existed (verified `requires_python >=3.9`, cp312/manylinux wheels present, not yanked). Immediate retry resolved `cryptography==50.0.2` and the package installed. Classified environmental (pip 24.0 + large simple page), **not a package defect**.

## Runtime dependency surfaces (from installed dist metadata)

| Package | Runtime deps | Cross-Forge deps | Node needed |
|---|---|---|---|
| theforge-core | **none** (stdlib-only) | — | no |
| apiforge-af | pydantic, typer, PyYAML, tree-sitter(+java/go), python-hcl2, graphql-core, cryptography | none | no |
| sparkforge-aws | PyYAML, jsonschema | none | no |
| sparkforge-azure | PyYAML, jsonschema | none | no |
| platformforge | PyYAML, jsonschema, python-hcl2 | none | no |
| forge-doctor-data | typer, rich, packaging | none | no |
| forge-doctor-api | typer, rich, PyYAML | none | no |
| theforge-cli | @clack/prompts, execa, figlet, picocolors | none | (it is the node tool) |

## CLI behavior spot checks

- `theforge --help` exposes the full verb surface (specialists, hosts, task, provider, plan, workspace, replay, resume, trace, memory, lab, remote…).
- `sparkforge-aws --help` renders the PT-BR command tree (analyze/collect/judge/knowledge/install…).
- `forge-doctor-api --help`: "Deterministic, offline-first API architecture intelligence."
- `forge-cli list` renders the 9-Forge catalog with per-forge state; `forge-cli doctor` runs **offline** diagnostics and prints `forge-health/v1` score (88/100, 19 checks with evidence) — no network, no checkout required.

## Verdict

**PASS** — all 8 published artifacts install from the public index alone, import/execute outside any checkout, and self-report the published version. No missing-file symptom observed (wheel contents verified separately in `sdist-wheel-reproducibility.md`).
