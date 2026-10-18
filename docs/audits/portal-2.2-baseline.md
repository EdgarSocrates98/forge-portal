# Portal 2.2 — Baseline Audit (Cycle 0)

Data: 2026-10-18 · Auditor: Devin CLI (execução direta, gates reais)

## HEAD

| Campo | Valor |
|---|---|
| HEAD `main` | `010441e` — `docs(2.1): independent final review — CONDITIONALLY_CERTIFIED (#42)` |
| Referência histórica do prompt | `010441e` (idêntico — mesma revisão) |
| Branches de trabalho | `portal-2.2/cycle0-baseline` |
| PRs abertos | 0 |
| Working tree | limpo |
| Checkout local | sincronizado com `origin/main` |

## Gates — evidência fresca (main, este checkout)

| Gate | Resultado |
|---|---|
| `npm ci` + `npm test` (vitest) | **493 passed** (49 files) |
| `npm run build` | OK — **369.09 kB raw / 97.52 kB transfer** inicial; 36+ lazy chunks (cytoscape-adapter 453.03 kB lazy) |
| `npx prettier --check` | clean |
| `scripts/check_i18n.py` | **957 pt-BR = 957 en**, 630 keys em uso |
| `ruff check .` | clean |
| `npm audit` | **0 vulnerabilidades** |
| `python -m pytest tests/` | **154 passed** (177s) |
| `python -m pytest e2e/` (Chromium real) | **43 passed** (260s) |

## Stack confirmada

Angular 22 + signals · Cytoscape (lazy chunk) · vitest 5.x · backend
`portal_core/forge_portal.py` stdlib-only (**1159 linhas, 66 defs**, sha256
`4186cebd…`) + `portal_core/telemetry.py` (EventRecorder, ops `/events` +
`/metrics`, 15 defs) + `portal_core/registry_ops.py`. Contrato
`forge/PortalApi/1` + `forge/PortalEvent/1`. 22 rotas registradas em
`app.routes.ts`. Dist: 42 arquivos, 1.5 MB.

## Versões publicadas (registry real, 2026-10-18)

| Pacote | PyPI/npm |
|---|---|
| theforge-core | 0.5.1 |
| apiforge-af | 0.1.1 |
| platformforge | 0.1.1 |
| sparkforge-aws | 0.5.1 |
| sparkforge-azure | 0.1.1 |
| forge-doctor-data | 1.0.1 |
| forge-doctor-api | 0.2.1 |
| theforge-cli (npm) | 0.2.1 |

## Vendor drift medido (Cycle 1 input)

| Forja | `_forge_portal.py` sha256 (16) | Linhas | Paridade |
|---|---|---|---|
| canonical (forge-portal) | `4186cebd6201eb93` | 1159 | — |
| the-forge | `a968ad06ee4c6d68` | 1111 | DRIFT (falta Cycle 6: XFO/Permissions-Policy + `send_error`) |
| api-forge | `a968ad06ee4c6d68` | 1111 | DRIFT (idem) |
| platform-forge | `4186cebd6201eb93` | 1159 | **byte-parity** |
| spark-forge-aws | `a968ad06ee4c6d68` | 1111 | DRIFT (idem) |
| spark-forge-azure | `a968ad06ee4c6d68` | 1111 | DRIFT (idem) |
| forge-doctor-data | `a968ad06ee4c6d68` | 1111 | DRIFT (idem) |
| forge-doctor-api | `a968ad06ee4c6d68` | 1111 | DRIFT (idem) |

Delta canônico→vendored confirmado por diff: exatamente as linhas de
`send_error()` com security headers + `import html` (trabalho do Cycle 6 de
segurança, PR #41). `platform-forge` já está em paridade — sua cópia vendored
foi atualizada depois da última propagação em massa.

## Gap P0 confirmado: telemetria federada

`default_operations()` (linha ~1064 do backend) expõe bootstrap/health/
environment/capabilities/registry/installation — **não expõe `/events` nem
`/metrics`**. Essas ops vivem em `portal_core/telemetry.py`
(`telemetry.operations(recorder, adapter)`), que **não é copiada pelo
`scripts/vendor.py`** (só copia `forge_portal.py` + assets + manifest).
Consequência real: os backends vendored têm o *harness* de telemetria
(`event_sink`, SseResult, timestamps reais) mas nenhum adapter dos irmãos
instancia `EventRecorder` nem monta as ops → `GET /api/v1/events` → 404 na
prática, confirmando o gap P0 do relatório 2.1.

## Matriz P0/P1/P2 com dono

| Prioridade | Item | Evidência | Dono técnico |
|---|---|---|---|
| P0 | 6 forjas com `_forge_portal.py` pré-Cycle-6 | sha table acima + diff | Integration Eng |
| P0 | `/events` 404 nas forjas (telemetry.py não vendored; adapters não montam ops) | análise acima + relatório 2.1 | Integration Eng + Backend Eng |
| P0 | Homologação E2E federada pós-fix | pendente Cycle 6 | QA Eng |
| P1 | Graph Studio: cose lento ≥1000 nós, sem layout adaptativo | benchmarks 2.1 (re-medir antes/depois) | Graph Perf Eng |
| P1 | Execution: ~53k DOM c/ 500 eventos | relatório 2.1 (re-medir) | Frontend/Observability |
| P1/P2 | Screen reader, zoom 200/400%, high contrast, usability real | a11y manual pendente | A11y Specialist |
| P2 | Matriz final de certificação + freezing policy | docs a produzir | Lead Architect |

## Skills/agents disponíveis (detectados neste host)

Subagent profiles relevantes instalados: Frontend Developer, UI Designer,
Accessibility Auditor, Section 508 Accessibility Specialist, Performance
Benchmarker, Data Visualization Engineer, UX Researcher, Evidence Collector,
Reality Checker, Test Automation Engineer, Code Reviewer, Security Architect,
Backend Architect. MCP: tokensave (code-graph) + rea. Ferramentas locais:
Chromium headless (usado nos e2e), Node v22.23.2, Python 3.12.3, uv/uvx,
gh CLI autenticado. Orca/screen readers: verificar no Cycle 5 (não assumir).

## Procedimento

Cada ciclo abaixo executa em branch própria com PR dedicada, gates reais e
evidência antes do merge — mesmo regime do Portal 2.1.
