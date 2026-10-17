# Forge Portal NextGen — baseline audit

Commit auditado: `8d957b5` (main, pós #23 registry ops). Angular 22 + vitest,
backend `portal_core/` stdlib-only (972 linhas `forge_portal.py` +
146 `registry_ops.py`).

## Estrutura real

- **17 pages**: agents, config, dashboard, explorer, federation, graph,
  hosts, install, knowledge, lab, match, mcp, observe, profiles, settings,
  skills, tasks, versions.
- **core/**: api, catalog, graph (`federated.ts` 405L + spec 295L), i18n
  (service + locales), match, portal, search, session, theme (`theme.store.ts`).
- **shared/**: command-palette, confirm-dialog, empty-state, error-state,
  filter-bar, forge-doc, icon, page-header, skeleton, state-badge, toast.
- **e2e/**: `test_browser_e2e.py` (harness próprio). Sem Playwright ainda.

## Matriz de funcionalidades (descoberta)

| Área | Estado | Evidência |
|---|---|---|
| Graph Studio | lista/inspector, **sem canvas** | `graph.page.ts`: "data views, no canvas", `<ul class="fed__nodes">` |
| Modelo federado | maduro | `buildFederatedGraph`, `FedNode/Edge`, `nodeNeighbors`, dedup, export JSON, estados de disponibilidade |
| i18n | PT-BR/EN presente | `core/i18n/` service+locales |
| Temas | store presente | `core/theme/theme.store.ts` |
| Registry ops | plan→confirm→execute | `portal_core/registry_ops.py` (#23) |
| Command palette | existe | `shared/command-palette.ts` |

## Pontos fortes

Modelo de grafo federado com evidências e dedup determinístico já é a base
certa para o canvas; backend com allowlist/CSRF/plan-token; componentes
shared já existem (não recriar).

## Problemas / gaps (priorização)

- **P0**: Graph Studio sem canvas visual — o ciclo principal do programa.
  Renderer none; nenhuma dep gráfica instalada (sem cytoscape/sigma/d3).
- **P0**: design tokens não formalizados (cores/espaço espalhados por CSS
  de página); dark/light/system/high-contrast/reduced-motion por auditar.
- **P1**: navegação plana de 17 páginas sem agrupamento por jornada
  (Overview/Explore/Operate/Analyze proposto no prompt).
- **P1**: E2E sem Playwright; testes visuais/perf/a11y ausentes.
- **P1**: dashboards/empty/loading states inconsistentes entre páginas.
- **P2**: onboarding inexistente; unified search limita-se ao palette;
  execution timeline/replay dependem de eventos reais (verificar fonte).
- **P2**: performance de grafo não medida; sem budgets de bundle.

## Riscos

- Renderer novo → CSP/bundle; mitigar com adapter desacoplado (§5.3).
- 5k–10k nós: exigir LOD/culling desde o design (§5.14 benchmarks).
- Independência das Forjas: portal continua opcional/read-capable.

## Dependências

Contratos `ForgeGraphView/v1`, `RegistryState/v1`, portal_core ops —
mudança incompatível exige coordenação com forge-cli/the-forge.
