# Portal 2.1 — Baseline Audit (Cycle 0)

Data: 2026-10-17 · Auditor: Devin CLI (execução direta, gates reais)

## HEAD

| Campo | Valor |
|---|---|
| HEAD | `ae3d81a` — `fix(portal): cookie forge_session sustenta sessão após reload + banner mostra erro real (#33)` |
| Referência histórica do prompt | `d31eac8` (3 commits atrás — #31/#32/#33 depois dela) |
| Branches | `main` apenas |
| PRs abertos | 0 |
| Working tree | limpo (artefatos e2e regenerados descartados) |

## Gates — evidência fresca (main, este checkout)

| Gate | Resultado |
|---|---|
| `npm test` (vitest+jsdom) | **385 passed** |
| `python -m pytest tests/` | **87 passed** |
| `python -m pytest e2e/` (Chromium real) | **25 passed** (executado nesta sessão, ~102s) |
| `npm run build` | OK — bundle inicial 352 kB raw / ~93 kB transfer, zero warnings |
| `ruff check portal_core/` | clean |
| `npx prettier --check` | clean |
| `scripts/check_i18n.py` | 785 pt-BR = 785 en, 513 keys em uso |
| `npm audit` | **0 vulnerabilidades** |

## Stack confirmada

Angular 22.2 standalone+signals · TS 6.0.3 · Cytoscape 3.34.3 (lazy) · axe-core 4.14 ·
vitest 5.0.3 · jsdom 30.1 · prettier 3.9.10. Backend `portal_core/forge_portal.py`
stdlib-only (63 defs). Contrato `forge/PortalApi/1`. 19 rotas, 47 arquivos de página/feat.

## Rotas (19)

dashboard · install · config · forges · forges/:id · match · federation · profiles ·
hosts · mcp · skills · agents · tasks · graph · observe · lab · versions ·
knowledge · settings

## Reconciliação dos 6 ciclos anteriores

| Ciclo | PR | Estado | Evidência |
|---|---|---|---|
| 1 Design tokens/temas/nav-jornada | #26 | PASS | `tokens.css`, dark/light/system/HC/reduced-motion, specs |
| 2 Graph Studio 2.0 | #25 | PASS | canvas Cytoscape lazy, 4 layouts, inspectors, export PNG/SVG |
| 3 Dashboard operacional | #27 | PASS | alertas acionáveis c/ fonte real, RegistryState |
| 4 Agent Studio + timeline | #28 | PASS | busca/filtros/comparação, replay honesto |
| 5 Busca unificada + recomendações | #29 | PASS | determinístico, motivo+fonte por recomendação |
| 6 Excellence (a11y/perf/sec/E2E) | #30 | PASS | axe 0 violações 13 rotas, perf baseline, security audit |
| Gaps follow-up | #31 | PASS | npm audit gate, CSS budgets, canvas e2e raster, TaskEvent.at |
| E2E ops reais | #32 | PASS | plan→confirm→execute, CSRF/replay/one-time-token |
| Sessão/reload + banner real | #33 | PASS | cookie-only auth (bound), error.session no banner |

## Gaps conhecidos herdados (honestos)

- Screen-reader real (NVDA/Orca/VoiceOver): **UNVERIFIED** — checklist manual em
  `docs/audits/a11y-manual-checklist.md`; axe cobre o automatizável.
- `TaskEvent.at` propagado, mas **nenhum produtor emite timestamp hoje** →
  timeline/replay dependem do Cycle 3 deste programa (instrumentação real).
- Replay usa `/metrics` por correlation_id — granularidade limitada.
- Canvas raster coberto por 3 e2e Chromium; visual review de todas as rotas
  por viewport/tema ainda não sistematizado → Cycle 1.
- Vendored copies: `the-forge` sincronizado (#85/#86); demais Forjas
  (spark-aws/azure, api, platform, doctors) rodam `_forge_portal.py` antigo
  → `scripts/vendor.py` pendente por repo (independência preservada).
- RAG/embeddings: fora de escopo até benchmark (§8.4 do programa anterior;
  search-benchmark em `docs/perf/` mostra busca estruturada suficiente).

## Inventário agentic (verificado nesta sessão)

- `~/.agents/skills`: 1.105 skills · `~/.claude/skills`: 216 · MCP: tokensave.
- Perfis úteis confirmados: `ui-designer`, `ux-researcher`, `frontend-developer`,
  `accessibility-tester`, `performance-benchmarker`, `code-reviewer`,
  `test-automator`, `data-visualization-engineer`, `security-auditor`,
  `angular-architect`, `ui-ux-tester`.
- Delegação real: `run_subagent` (Devin CLI) — usado nos ciclos.

## Riscos / atenção para o 2.1

- Vendors: propagar o fix de sessão (#33) para spark-aws/azure, api-forge,
  platform-forge, doctor-data/api — senão o bug do reload persiste neles.
- E2E e browser real exigem Chromium local; CI roda o mesmo harness.
- Qualquer novo campo de telemetria é **aditivo** (contrato `forge/PortalApi/1`
  não pode quebrar produtores antigos).
