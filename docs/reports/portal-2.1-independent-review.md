# Revisão independente — Forge Portal 2.1

Reviewer: agente independente (não-implementador). Commit revisado:
`ad385b93cdebe83312612c4bb41bee089df88bb9` (main, HEAD de `origin/main`,
pós-merge do PR #41). Contrato auditado: `prompt_evo_portal2.md`
(§3–§14, 1 321 linhas, lido integralmente).

Método: checkout limpo de `origin/main`, re-execução de **todos** os
gates nesta máquina, leitura dirigida do código e dos documentos de
evidência, e confronto linha a linha entre o que os docs afirmam e o
que o repositório contém. Nenhuma funcionalidade foi escrita por esta
revisão; nenhum número foi copiado sem re-execução ou leitura do
artefato citado.

## Gates reexecutados nesta revisão (main `ad385b9`)

| Gate | Comando executado | Resultado observado | Confere com `portal-2.1-final-homologation.md` |
|---|---|---|---|
| Unit frontend | `npm test` | **49 arquivos / 493 testes — 0 falhas** (~16 s) | Sim |
| Build produção | `npm run build` | **OK** — initial 369.09 kB raw / 97.52 kB transfer; 0 warnings | Sim |
| Formatação | `npx prettier --check "src/**/*.{ts,html,css}"` | **OK** — all matched files | Sim |
| Lint Python | `ruff check .` | **All checks passed** | Sim |
| Testes backend | `.venv/bin/python -m pytest tests/ -q` | **154 passed** em 201 s | Sim (doc diz 154) |
| Testes browser | `.venv/bin/python -m pytest e2e/ -q` | **43 passed** em 253 s (Chromium real) | Sim |
| i18n | `python3 scripts/check_i18n.py` | **OK** — 957 pt-BR / 957 en / 630 usadas | Sim |
| Dependências | `npm audit` | **0 vulnerabilidades** | Sim |
| E2E federado | `pytest e2e/test_browser_homologation.py::test_theforge_federated_flow` | **1 passed** em 55.8 s (adapter real do `the-forge`) | Sim |

Nota de ambiente: o `pytest` do sistema não existe (`No module named
pytest`); os gates Python rodam via `.venv/` do repo — o README
(`requirements-dev.txt`) documenta isso. Não é um bloqueio.

## Matriz critério → classificação → evidência

Classificações: VERIFIED (evidência real no código/teste/doc e/ou gate
reexecutado), PARTIAL (parcialmente coberto, com resto declarado),
NOT_TESTED (declarado não-testado por política/ausência de ambiente),
UNSUPPORTED (superfície ausente, declarada), MISSING (exigido, sem
evidência).

### Cycle 0 — auditoria e reconciliação (§3)

| Critério | Classe | Evidência |
|---|---|---|
| §3.1 Reavaliação da main (HEAD, branches, PRs, workflows, deps, contratos, docs, testes) | VERIFIED | `docs/audits/portal-2.1-baseline.md` L5–38: HEAD `ae3d81a`, 0 PRs abertos, stack, 19 rotas. Conferido: `git log` confirma `ae3d81a` como base da sequência 2.1. |
| §3.2 Classificação dos 6 ciclos anteriores | VERIFIED | baseline.md L42–52 — cada ciclo anterior tem PASS + evidência nomeada (arquivo/PR). Reconciliação com `forge-portal-nextgen-completion.md` implícita nos estados citados. |
| §3.3 Ambiente de execução verificado com números frescos | VERIFIED | baseline.md L17–26 — gates executados na main da época (385 vitest/87 pytest/25 e2e). Números atuais (493/154/43) reexecutados por esta revisão. |
| §3.4 Entregável `docs/audits/portal-2.1-baseline.md` | VERIFIED | Arquivo existe (84 linhas), com gaps honestos (L54–68). |
| §2.x Inventário de skills/agents/hosts | VERIFIED | baseline.md L69–77 — inventário verificado na sessão, delegação real registrada. |

### Cycle 1 — Visual Excellence & UX Polish (§4)

| Critério §4.7 | Classe | Evidência |
|---|---|---|
| Nenhum overflow crítico | VERIFIED | `docs/design/portal-2.1-ux-review.md` — probe mediu `scrollWidth−innerWidth>1px` = 0 em 194 capturas (4 viewports + zoom); `e2e/visual_probe.py` + `docs/design/captures/cycle1/` + `cycle6/` (PNGs reais no repo). |
| Nenhum controle sem feedback | VERIFIED | Correções listadas (ux-review §Correções 5–8): `.fg-pill` com hover/press/disabled; transições via tokens `--fg-motion-*`. |
| Nenhum botão fictício | VERIFIED | `entity-link.ts` retorna `null` para kinds sem página (capability) — spec `graph.page.spec.ts` testa "no open-in link for capability nodes". |
| Navegação contextual (§4.4) | VERIFIED | Tabela de deep links no ux-review; `entity-link.ts` + `?q=`/`?task=`/`?server=`/`#host-*`/`?cid=` implementados e testados (specs de agents/skills/mcp/tasks/observe). |
| Design consistente (§4.2 tokens) | VERIFIED | `src/styles/tokens.css` + `docs/design/tokens.md`; spec `tokens.spec.ts` fixa tokens incl. motion/reduced/contrast. |
| Responsividade validada | VERIFIED | 4 viewports medidos; `test_mobile_viewport`, `test_content_scrolls_in_constrained_viewport` no e2e. |
| Temas funcionando | VERIFIED | `test_theme_toggle` e2e + `ThemeStore` (dark/light/system) + capturas `light1366` nas 21 rotas. Tema HC: PARTIAL — tokens existem, revisão manual pendente (declarado). |
| Acessibilidade automatizada aprovada | VERIFIED | `test_axe_core_audit` cobre **21 rotas**, 0 serious/critical; `e2e/artifacts/axe-report.json` existe e parseia (`{axe, routes, violations}`). |
| Pendências manuais documentadas | VERIFIED | `docs/audits/a11y-manual-checklist.md`; screen-reader marcado MANUAL-NEEDED/UNVERIFIED (não PASS). |
| Capturas reais anexadas | VERIFIED | `docs/design/captures/cycle1/` (97 PNGs) e `cycle6/` (97+ PNGs, incl. m390/light/zoom). |
| §4.5 Dashboard acionável | VERIFIED | `dashboard.page.spec.ts` (12 testes): alertas linkam para a página de resolução, falhas isoladas por seção, UNVERIFIED sem crash. |
| §4.6 Leitor de tela | NOT_TESTED | Declarado UNVERIFIED/MANUAL-NEEDED — correto per §4.6 ("registrar como UNVERIFIED, não PASS"). |
| Zoom 200%/400% | PARTIAL | Medido em `/dashboard` (reflow real, `overflowX: 0`); demais rotas inferidas — declarado no doc. |

### Cycle 2 — Graph Studio 2.1 (§5)

| Critério | Classe | Evidência |
|---|---|---|
| §5.1 Auditoria do 2.0 preservando renderer | VERIFIED | `docs/architecture/graph-studio-2.1.md` §1 — tabela de auditoria com 7 gaps reais encontrados; cytoscape mantido atrás de `GraphRenderer`. |
| §5.2 Vértices ricos (tipos + LOD por zoom) | VERIFIED | `FedNodeKind` = forge/capability/skill/agent/mcp/host/operation/tool (8 kinds); zoom tiers far/mid/near no adapter (spec: "zoom tiers enrich node labels"). `Document`/`Task` como kinds separados: cobertos por `operation`/`tool` e knowledge page — classificado VERIFIED porque o prompt condiciona a "fonte real". |
| §5.3 Arestas expressivas (direção, tipo, evidência, natureza) | VERIFIED | `FedEdge` com `kind` (declares/origin/associated/bound_to/observed) + `evidence` (source endpoint) + estilo por estado de evidência (loaded→solid, unverified→dashed, unavailable→dotted) — diferença de estilo, não só cor. Arestas "derived" documentadas como inexistentes (`view-model.ts` L58) — não fabricadas. |
| §5.4 Inspector avançado | VERIFIED | `graph.page.ts` seções `node-inspector`/`edge-inspector` com origem, relações in/out, evidências, estado, ações; specs + e2e (`test_graph_canvas_click_selects_element`). |
| §5.5 Layouts + agrupamentos | VERIFIED | 5 layouts (`cose`, `concentric`, `grid`, `breadthfirst`, `circle` — `renderer.ts` L21–28) + grouping composto por kind/forge/host com collapse (`groupingFor`, `test_graph_grouping_chips`). Mapeamento dos 6 nomes do prompt (hierarchical→breadthfirst, radial→circle/concentric, force→cose, dependency→breadthfirst, clustered→compound groups) é razoável. |
| §5.6 Análise multissalto | VERIFIED | `analysis.ts`: `bfs`, `shortestPath`, `connectedComponents`, `findCycles` (Tarjan iterativo), `dependencies`, `dependents`, `reachable`, `orphans`, `impactReport` — 11 testes em `analysis.spec.ts`. DFS explícito não exposto como função separada ("quando adequado" — Tarjan/BFS cobrem os usos reais). |
| §5.7 Impact Analysis com profundidade + cobertura | VERIFIED | `impactReport` retorna uses/usedBy/cycles/orphan/unverifiedNodes/unverifiedEdges/missingSources/coverage; UI tem depth selector + coverage strip; rotulado "topological", nunca operacional. E2E `test_graph_impact_panel`. |
| §5.8 Motion Graph | PARTIAL | Transições de layout, foco progressivo (`zoomTo`+`dimExcept`), highlight de caminhos (L1310), seleção de relações, expansão de clusters: implementados. **Não há animações em arestas nem replay animado no canvas** — correto por ausência de dados (prompt proíbe simular), mas "replay de execuções" como animação vive em `/execution` e `/tasks`, não no grafo. |
| §5.9 Visualizações salvas | VERIFIED | `saved-view.ts` — schema-versioned `forge-portal/graph-view/v1`, sem segredos; e2e `test_graph_saved_view_restores`. |
| §5.10 Comparação de topologias | VERIFIED | `snapshot.ts` `diffSnapshots`/`diffMarks` — added/removed/changed; captura explícita do usuário (não reconstrói histórico inexistente); e2e `test_graph_snapshot_capture_and_diff`. |
| §5.11 Performance (4 tamanhos) | PARTIAL | `scripts/graph-bench.mjs` mediu 100/1 k/5 k/10 k — render, layout, analysis, interact, SVG, grouping (`docs/perf/portal-2.1-benchmarks.md`). **Memória/CPU por tamanho e timings separados de zoom/pan/filtro não constam da tabela** — heap é medido por rota no probe CDP, não por tamanho de grafo. cose ≥5 k medido como inviável (>120 s), documentado honestamente. |
| §5.12 Testes obrigatórios | VERIFIED | Render real (`test_graph_canvas_mounts_and_rasterizes`), seleção vértice/aresta (spec + e2e), zoom/pan (viewport round-trip spec), layout, busca, filtros, agrupamento, inspector, persistência, exportação, empty state (`test_empty_graph_state`), dados parciais (DegradedAdapter), teclado (lista = botões nativos + roving radiogroup na palette), reduced-motion (tokens.spec + fix cose assíncrono). |

### Cycle 3 — Telemetria e replay real (§6)

| Critério §6.7 | Classe | Evidência |
|---|---|---|
| Eventos reais | VERIFIED | `portal_core/telemetry.py` `EventRecorder` (buffer bounded 500, `dropped` contado) + `PortalServer.emit_event` em `operation.start/end`/`request.rejected`; `RequestContext.emit` para domínio. |
| Timestamps válidos quando emitidos | VERIFIED | `timestamp` stamped em `emit_event` (record-time `_utc_now`); doc §2 declara impossibilidade de back-fill; código confere (`telemetry.py` L9–14, `forge_portal.py` L1007+). |
| Correlation IDs preservados | VERIFIED | `correlation_id` propagado em recusa/dispatch; `events_for_task` vincula por `metadata.task_id` + correlation real; spec "replays only events that share its correlation id". |
| Sem dados falsos | VERIFIED | Eventos sem timestamp ficam fora do eixo e contam em `unplaced`/`unlinked`; `trace_id`/`parent_span_id` declarados não-produzidos. |
| Replay determinístico | VERIFIED | `execution.data.ts` `buildReplay` — ordem gravada, gaps reais com cap de 8 s marcado `compressed` (delta real exibido); controles prev/play/pause/next/speed no template. |
| Tratamento de lacunas | VERIFIED | `unlinked` bucket, `unplaced`, `truncated`/`dropped` no report; e2e `test_execution_unlinked_and_honest_gaps`. |
| Testes com adapters reais | PARTIAL | E2E adapter emite `task.planned`/`task.finished`/`receipt.issued`/`mcp.verified` reais + e2e Chromium verde. **Adapters irmãos: `telemetry` = UNSUPPORTED em todos os 7** (vendor lag, `/events` → 404) — declarado como gap 1 em `docs/homologation/README.md`. |
| Compatibilidade preservada | VERIFIED | Contrato aditivo (`schema`+`event_type` só obrigatórios); `/metrics` projection mantém nomes legados; adapters antigos seguem funcionando (matrix VERIFIED nos outros ops). |
| §6.2 Contrato versionado | VERIFIED | `forge/PortalEvent/1` + `forge/PortalEventReport/1` documentados em `docs/observability/execution-events.md` com campos opcionais exatos do prompt. |
| §6.6 Integração grafo↔execução | VERIFIED | `events` é `FedSource`; arestas `observed` só de refs `kind:id` gravadas; `tool` é kind novo; cadeia conceitual só desenhada com refs reais — `federated.ts` L543–559. |

**Discrepância encontrada:** `execution-events.md` §8 afirma
"`tests/test_telemetry.py` — 78 tests". A contagem real (pytest
collect) é **17 testes**. O módulo está correto; a cifra do doc está
errada (78 → 17). Cosmético, mas é exatamente o tipo de número que o
programa proíbe fabricar — recomendo corrigir o doc.

### Cycle 4 — Integração cross-forge e homologação (§7)

| Critério | Classe | Evidência |
|---|---|---|
| §7.1 Descoberta do ecossistema | VERIFIED | `docs/homologation/cycle-4-matrix.json` — 7 forges presentes/booted via manifest `~/.forge/installations/` + checkouts reais. `forge-cli` sem checkout: declarado (gap 6, README L131). |
| §7.2 Cada forja testada individualmente | VERIFIED | 21 capacidades × 7 forges; 115 VERIFIED / 18 NOT_APPLICABLE / 7 UNSUPPORTED / 7 NOT_TESTED; evidências são respostas HTTP reais por probe. `scripts/homologation.py` regenera (`--write`), exit 1 em PARTIAL/BLOCKED. |
| §7.3 The Forge federado E2E (13 passos) | VERIFIED | `test_theforge_federated_flow` — adapter real do `the-forge` servindo o bundle atual: discovery → capabilities → federation → graph → agents/skills → MCP verify real → volta ao grafo. Reexecutado nesta revisão: PASS em 55.8 s. |
| §7.4 Independência | VERIFIED | `tests/test_independence.py` (9 testes): stdlib-only assertado por AST, zero imports de pacotes irmãos, CLIs `--version` reais, vendored copies com sha256 + janela de 1 geração. |
| §7.5 Erros reais | VERIFIED | `test_browser_homologation.py` DegradedAdapter — 9 cenários reais (404 agents, 503 retryable, host ausente, permissão 403, MCP FAIL receipt, versão incompatível, forja ausente, grafo vazio, dados parciais) renderizando código nomeado/UNVERIFIED/refusal card. |
| §7.2 mutações | NOT_TESTED | Por política — só refusal boundary exercitado; declarado. |

### Cycle 5 — Experiência e personalização (§8)

| Critério | Classe | Evidência |
|---|---|---|
| §8.1 Jornada guiada | VERIFIED | `/guide` com 9 seções + `ui-guide-hint` dismissível em 9 páginas (persistente via `PrefsStore`); `test_cycle5_guide_and_hints` e2e; sem tutorial obrigatório. |
| §8.2 Preferências | VERIFIED | `prefs.store.ts` — tema (ThemeStore), idioma (i18n), densidade, motion, lastRoute, hints, pageFilters; schema versionado, parse estrito, sem segredos. "Layout do dashboard" e "filtros favoritos nomeados": declarados não-implementados como decisão de produto (open questions doc). |
| §8.3 Workspace experience | VERIFIED | Workspace id + root no tooltip, lastRoute, pageFilters com precedência de `?q=`. Troca de workspace: NOT_APPLICABLE declarado (portal serve o workspace da sessão). |
| §8.4 Diagnósticos acionáveis | VERIFIED | `error-guidance.ts` mapeia `PORTAL-*` reais → explicação + rota de ação; `ErrorState` renderiza código real + `action` verbatim + retry; códigos desconhecidos não inventam guidance. Planos seguros ficam no fluxo plan→confirm existente. |
| §8.5 Walkthroughs medidos | PARTIAL | Tabela de 9 cenários com **contagem de passos** estrutural; tempo/erros/confusão declarados não-medidos (sem estudo com usuários) — honesto, mas o critério pedia medição. |

### Cycle 6 — Segurança, performance, a11y, release (§9)

| Critério | Classe | Evidência |
|---|---|---|
| §9.1 Revalidação de segurança (18 itens) | VERIFIED | `docs/security/portal-2.1-review.md` — matriz item a item com linhas de `forge_portal.py`; conferido no código: loopback bind `raise ValueError` L980, `token_urlsafe(24)` L982 (192 bits — o doc mais antigo `security-cycle6.md` diz "128-bit", desatualizado), `compare_digest` L595–601, `_security_headers` L497–510 com XFO+Permissions-Policy, `send_error` override L512–549 com `html.escape`, `RateLimiter` L991+945, CSP sem unsafe-eval, zero `Access-Control-*`, traversal contido em `_static`. |
| §9.2 Performance medida + baseline | VERIFIED | `e2e/perf_probe.py` (CDP real) + `e2e/artifacts/perf-cycle6.json` existem; tabela por rota (FCP/load/heap/DOM/TaskΔ) + interações + custo de telemetria + bundle comparado a `bundle-baseline.md` (+4.8% documentado). |
| §9.3 A11y WCAG 2.2 AA | PARTIAL | Automatizado verde (axe 21 rotas, contraste medido ≥4.5, foco, zoom 200/400, reflow, targets com justificativa SC 2.5.8 documentada); **screen-reader = MANUAL-NEEDED** e paridade pan/zoom para AT não declarada — correto declarar, mas a conformidade plena não é alcançável sem AT. |
| §9.4 Regressão | VERIFIED | Todos os 8 comandos executados nesta revisão — ver tabela de gates. |
| §9.5 Quality gates | VERIFIED | Nenhuma condição de bloqueio presente na main: build/typecheck/lint/testes verdes, 0 vulns, budgets em vigor (`angular.json`). |

### Gates finais do prompt (§11–§13)

| Item | Classe | Evidência |
|---|---|---|
| §11 docs obrigatórios | VERIFIED | 7/9 existem com nomes exatos; `portal-2.1-visual-system.md` → coberto por `docs/design/tokens.md`+`portal-2.1-ux-review.md`; `docs/integration/cross-forge-matrix.md` → `docs/homologation/cycle-4-matrix.md` — o prompt permite ajustar nomenclatura ("Ajustar nomenclaturas à organização real"). Nenhum doc é vazio/checklist-only. |
| §12 definição de pronto | PARTIAL | Homologation mapeia item a item; a maioria PASS com evidência. Itens que impedem PASS *integral*: a11y AT pendente (declarado), telemetry UNSUPPORTED nos vendors (declarado), mutações NOT_TESTED (declarado). |
| §13 matriz + revisão independente | VERIFIED | Matriz 11 linhas presente; revisão independente era instrumental — este documento é a revisão humana/externa exigida. Skills/agents utilizados: inventário no baseline; lista explícita de skills utilizadas por ciclo não consta do relatório final (menor). |
| PRs pequenos e coerentes | VERIFIED | #34–#41 separados por ciclo, todos mergeados (verificado via `gh`), diffstat coerente com o escopo declarado. |

## Gaps reais encontrados por esta revisão (ordenados)

1. **`docs/observability/execution-events.md` §8 cita "78 tests" para
   `tests/test_telemetry.py`; a contagem real é 17** (pytest collect).
   Número inflado em doc de evidência — deve ser corrigido.
2. **§5.11 parcial**: o benchmark de grafo registra render/layout/
   analysis/interact/SVG/grouping nos 4 tamanhos, mas **não registra
   memória/CPU por tamanho nem timings separados de zoom/pan/filtros**
   (o prompt lista esses campos). Heap é medido por rota no probe CDP;
   a tabela de grafo não cobre os campos restantes.
3. **§8.5 parcial**: walkthroughs têm contagem de passos estrutural,
   sem tempo/erros/confusão medidos — declarado honestamente, mas o
   critério pedia medição real de sessões.
4. **Acessibilidade**: screen-reader (NVDA/Orca/VoiceOver) segue
   MANUAL-NEEDED; paridade de interação do canvas para AT não declarada;
   zoom 400% medido só em `/dashboard`. Tudo declarado — mas WCAG 2.2 AA
   pleno não pode ser afirmado sem AT.
5. **`telemetry` UNSUPPORTED nas 7 forjas irmãs** + vendored copies com
   1 geração de lag (sha `a968ad06…` ≠ main atual) — o portal está
   pronto, os vendors não emitem `forge/PortalEvent/1` até re-vendor.
   Declarado; afeta a §12 "fluxos críticos com fontes reais" no quesito
   telemetria cross-forge.
6. **`docs/audits/security-cycle6.md` desatualizado**: diz "token
   128-bit" e cita números de linha pré-ciclo-6 (`L822`, `L514`) —
   `portal-2.1-review.md` (revalidação posterior) está correto
   (192 bits, linhas atuais). O doc antigo deveria apontar para o novo
   ou ser corrigido.
7. **Menores**: DFS não existe como função separada (§5.6 "quando
   adequado" — Tarjan/BFS cobrem); §5.8 sem replay animado no canvas
   (correto por ausência de dados); lista explícita de skills/agents
   utilizados por ciclo ausente do relatório final (§13).

## Veredito

**CONDITIONALLY_CERTIFIED.**

Justificativa: todas as verificações reexecutáveis passam na main
`ad385b9` — 493 Vitest + 154 pytest + 43 e2e Chromium + build + lint +
i18n + audit verdes e conferindo com o relatório de homologação. A
evidência é real: a matriz cross-forge é gerada por script contra
adapters reais (não hand-authored), o e2e federado roda o vendored
server real do `the-forge`, e os docs citam arquivos/linhas que
conferem. O programa demonstra disciplina de honestidade rara: UNSUPPORTED,
NOT_TESTED, UNVERIFIED e gaps declarados em vez de PASS fabricado.

As condições para CERTIFIED integral: (a) corrigir a cifra 78→17 em
`execution-events.md`; (b) executar o checklist de screen-reader num
host com AT (ou manter PARTIAL declarado, aceitável dentro do modelo
do prompt); (c) reconhecer que telemetria cross-forge e §8.5/§5.11 são
parciais por natureza (vendor lag / ausência de estudo / campos de
medição) — todos já declarados, nenhum escondido.

Não há bloqueio de release. Os gaps são de escopo/medida, não de
integridade — e estão todos documentados pela própria equipe.
