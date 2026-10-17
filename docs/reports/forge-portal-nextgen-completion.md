# Homologação — Forge Portal NextGen (6 ciclos)

Data: 2026-10-17. Branch de encerramento: `feat/excellence` → gaps do
relatório fechados em `fix/nextgen-gaps` (ver § "Fechamento de gaps"
abaixo).
Status geral: **PARTIAL → PASS pendente apenas de verificação manual com
leitor de tela** — todos os gates automatizados verdes, auditorias
estáticas completas e documentadas.

## Sumário executivo

Seis ciclos transformaram o portal de um painel funcional (17 páginas,
sem canvas, sem sistema de design) em um produto com design tokens,
Graph Studio com canvas Cytoscape lazy, dashboard operacional, Agent
Studio, busca unificada explicável e — neste ciclo — conformidade WCAG
2.2 AA estática, baseline de performance medida, fronteiras de segurança
revalidadas e arquitetura documentada.

## Capacidades usadas (do inventário, `docs/audits/agentic-capabilities-inventory.md`)

| Capacidade | Uso real no ciclo 6 |
|---|---|
| accessibility-audit/-fix | auditoria estática programática + correções de contraste/semântica |
| design-system | split `--accent` → `--accent-ink`/`--accent-fill` por forja/esquema |
| playwright (python, já em requirements-dev) | 2 novos fluxos E2E (grafo, tema) — sem lib nova no frontend |
| security-review | revalidação CSP/CSRF/loopback/allowlist/redação |
| webapp-testing | verificação em Chromium real contra bundle real |

Nenhuma dependência nova de runtime foi adicionada.

## Matriz dos 6 ciclos

| Ciclo | PR | Implementação | Testes | Gaps |
|---|---|---|---|---|
| 0 — baseline + inventário | #24 (`164143c`) | auditoria + inventário agentic | — | — |
| 1 — design tokens/temas/nav | #26 (`69c345e`) | `tokens.css`, light/dark/system, acentos por forja, nav por jornada | specs de tema | contraste AA só corrigido no ciclo 6 |
| 2 — Graph Studio 2.0 | #25 (`4f93783`) | canvas Cytoscape, renderer abstraction, inspetor, alternativa de lista | specs federated/view-model | paridade de interação AT no canvas = lista |
| 3 — dashboard operacional | #27 (`8ac233b`) | alertas acionáveis, estados por seção | specs de falha isolada | — |
| 4 — Agent Studio | #28 (`c47e74e`) | busca/filtros/comparação/timeline | specs de página | timeline depende de eventos reais dos hosts |
| 5 — busca unificada + recomendações | #29 (`37337d3`) | palette agrupada, fontes lazy, "por quê" explicável | specs de search | — |
| 6 — excelência + homologação | este PR | a11y AA estática, perf baseline, security revalidada, docs, E2E +2 | 376 vitest, 17 E2E | verificação manual com SR pendente |

## Decisões-chave do ciclo 6

1. **Contraste corrigido na camada de tokens, não em componentes** —
   `--accent` (matiz de marca) permanece para não-texto; `--accent-ink`
   é a única variante para texto; `--accent-fill` para superfícies com
   `--accent-fg`. Valores por forja e por esquema, todos ≥ 4.5:1 por
   cálculo WCAG.
2. **Sem otimização sem medida** — bundle medido e registrado
   (`docs/perf/bundle-baseline.md`); 92.98 kB de transferência inicial
   julgado aceitável para admin local-first; Cytoscape já é lazy.
3. **`icon.ts` bypass documentado, não removido** — o valor vem de mapa
   constante de compile-time; remover quebraria os ícones sem ganho de
   segurança. Registrado como aceite em `security-cycle6.md`.
4. **Auditoria de a11y codificada como testes** — `src/app/a11y.spec.ts`
   transforma os achados em regressão permanente em vez de PDF morto.

## Gates (todos verdes no commit do PR)

| Gate | Resultado |
|---|---|
| `npm test` (Vitest) | 38 arquivos, **376 testes** PASS |
| `npx ng build` | PASS; warnings de CSS budget registrados no baseline |
| `npx prettier --check` | PASS |
| `python3 scripts/check_i18n.py` | 751 keys pt-BR = 751 en |
| `ruff check` | PASS |
| `pytest tests/` | 81 PASS |
| `pytest e2e/` (Chromium real) | **17 PASS** (15 existentes + grafo + tema) |

## Estado por requisito do ciclo 6

| Área | Status |
|---|---|
| A11y — foco, reduced-motion, landmarks, headings, tables, diálogos, grafo, aria-live, skip link | PASS (estático + testes) |
| A11y — verificação com leitor de tela | **MANUAL-NEEDED** (sem AT no ambiente) |
| A11y — contraste AA | PASS (corrigido + calculado) |
| Performance — baseline de bundle | PASS (`docs/perf/bundle-baseline.md`) |
| Segurança — CSP/CSRF/loopback/allowlist/redação | PASS (`docs/audits/security-cycle6.md`) |
| E2E — fluxos críticos em browser real | PASS (primeiro acesso via rotas, grafo+seleção, palette, tema) |
| Docs — arquitetura frontend | PASS (`docs/architecture/frontend.md`) |

## Features não concluídas / gaps honestos

- **Screen-reader walkthrough**: nenhum AT disponível; ordem de anúncio
  e verbosidade ficam como pendência manual, não PASS — passos em
  `docs/audits/a11y-manual-checklist.md`.
- **Zoom 200%/400% e reflow**: não medidos em viewport real.
- **Timeline de Agent Studio**: depende de hosts que emitem eventos —
  o E2E usa adapter, não host real.

## Fechamento de gaps — `fix/nextgen-gaps` (2026-10-17)

Os cinco gaps remanescentes deste relatório foram atacados na branch
`fix/nextgen-gaps`. Resultados honestos (evidência em
`e2e/artifacts/` e nesta doc):

| Gap | Status | Evidência |
|---|---|---|
| `npm audit` nunca executado | **PASS** — `found 0 vulnerabilities`; nenhum fix necessário | saida do gate |
| CSS budget warnings (install 6.69 kB, tasks 5.63 kB, hosts 4.01 kB vs budget 4 kB) | **PASS** — os três ≤ 4 kB após dedup para `styles.css`/`tokens.css`; `ng build` sem nenhum warning | build gate |
| Canvas Graph Studio sem cobertura real de browser | **PASS** — 3 novos testes Chromium: raster (pixels pintados), clique→inspector, seleção compartilhada lista↔canvas | `e2e/artifacts/18..20-*.png` |
| A11y só estática/manual | **PASS parcial** — `test_axe_core_audit` injeta axe-core 4.14.0 em Chromium real nas 13 rotas; **zero** violações em qualquer severidade após correções reais; manual segue pendente | `e2e/artifacts/axe-report.json`, `docs/audits/a11y-manual-checklist.md` |
| Timestamps em eventos persistidos | **PASS** — `MetricsEvent.at` já ordena/renderiza o replay (código pré-existente em `tasks.data.ts`); `TaskEvent` ganhou `at?` aditivo — nenhum produtor emite hoje (grep: só `SseResult` passthrough); nada inventado | `api.models.ts:261`, grep evidence abaixo |
| Benchmark busca estruturada vs embeddings | **PASS** — p95 ≤ 16.3 µs local no corpus real (35 entradas); `/docs/search` ~1.9 ms; conclusão: busca estruturada suficiente, critérios de reavaliação registrados | `docs/knowledge/search-benchmark.md` |

**Bugs reais encontrados pela varredura axe (corrigidos nesta branch):**

- Templates `/skills` e `/agents` lançavam `TypeError` com adapters que
  omitem campos (`s.hosts.length` sobre `undefined`) — o crash abortava o
  passo de update do CD e deixava `aria-label`/`placeholder` sem bind
  (axe `button-name` critical + `label` critical). Correção: normalização
  defensiva no boundary (`api.client.ts` skills/agents) — arrays ausentes
  viram `[]` e renderizam UNVERIFIED, nunca um valor inventado.
- `label-content-name-mismatch` (WCAG 2.5.3) nos botões da topbar: o
  texto visível (`Ctrl K`, `PT`/`EN`) não constava no nome acessível —
  agora consta.
- `color-contrast` serious em `/graph` (`.fed__node` sem `background` →
  buttonface cinza do UA; `[data-unverified]` com `opacity: 0.72`) e em
  `/hosts` (`.host[data-off]` com `opacity: 0.55`) — opacidade substituída
  por superfície translúcida/desaturação; contraste de texto restaurado.
- `landmark-unique` (moderate): asides do shell e das páginas install/
  federation ganharam `aria-label` i18n.
- Fixture e2e `hosts()` retornava o shape legado `{id,name,state}` —
  h2s vazios (axe `empty-heading`); agora emite `HostDetection` real.
- `test_no_console_errors` endurecido: captura `console.error` de
  templates Angular (TypeError silencia binds) em 6 rotas, além de
  `pageerror`.

**Grep evidence — timestamps**: `MetricsEvent.at` já existe e ordena o
replay (`tasks.data.ts:143-152`); `TaskExecution.started_at/finished_at`
dirigem a timeline (`tasks.data.ts:72-103`); para `TaskEvent` (SSE), o
único produtor em `portal_core/forge_portal.py` é `SseResult`
(passthrough de dicts do adapter, linha ~102/675-702) e nenhum adapter/
fixture emite `at` — o campo opcional `TaskEvent.at` (`api.models.ts`)
está pronto para quando um adapter passar a carimbar; consumidores nunca
inferem o valor.

## Recomendações futuras

1. Sessão manual com NVDA/VoiceOver sobre: nav por jornada, palette,
   confirm dialog, lista do grafo — validar o que o estático não cobre.
2. Rodar `npm audit` em CI e fixar política de severidade.
3. Usar `bundle-baseline.md` como regressão: alarmar se initial > 400 kB.
4. Considerar renderer de grafo alternativo ou code-splitting interno do
   Cytoscape **somente se** medição mostrar impacto (hoje é lazy — OK).
5. Aumentar budget de CSS por componente ou dividir estilos das páginas
   install/tasks — decisão de design, não urgência.
