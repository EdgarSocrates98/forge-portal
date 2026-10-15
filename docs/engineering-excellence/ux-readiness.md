# UX readiness — Forge Portal

**Data da auditoria:** 2026-10-12
**Branch:** `codex/evo-grill-2026-10-12`
**Decisão:** documentação somente; nenhum código ou screenshot foi alterado.

## Escopo e método

Esta é uma auditoria de prontidão UX baseada na implementação Angular, no
servidor local e nos artefatos E2E já presentes no repositório. Foram
inspecionados o shell, as rotas de status, grafo e evidência, os estados
compartilhados e os breakpoints CSS. O artefato existente
`e2e/artifacts/02-language-toggle.png` já estava modificado antes desta
auditoria e foi preservado byte a byte; nenhum artefato em `e2e/artifacts/`
foi regenerado.

O resultado abaixo separa capacidades comprovadas de lacunas observáveis no
código. Não é uma certificação WCAG nem substitui teste manual com leitor de
tela, teclado, zoom e navegadores adicionais.

## TTY e non-TTY

TTY/non-TTY não é uma dimensão aplicável à UI do Portal: o Portal é uma SPA
Angular executada no browser, consumindo a API HTTP local. Não há leitura de
`stdin` nem chamadas `isatty` no código da aplicação em `src/`; ocorrências de
“terminal” são affordances visuais/operacionais, como o ícone e o atalho
`Ctrl K`.

O limite correto aparece na tela de Hosts: o browser não tenta iniciar um host
diretamente; a tela oferece um comando copiável e explica para executá-lo no
terminal (`src/app/pages/hosts/hosts.page.ts:78-93`). Isso está alinhado ao
contrato e à matriz de segurança (`docs/fase0/contracts.md:66-83` e
`docs/fase0/security-matrix.md:21-26`). Portanto, não se deve criar um
estado de “TTY disponível” no Portal. O que pode ser auditado aqui é a clareza
da transferência browser → terminal.

## Telas e evidências

### Status

- O shell expõe estado global (`booting`, `ready`, `degraded`, `offline`) no
  `PortalStore` (`src/app/core/portal/portal.store.ts:8-72`).
- O dashboard mostra saúde, checks, capacidades e versão; durante o bootstrap
  mostra skeletons, e quando não há dados usa empty state
  (`src/app/pages/dashboard/dashboard.page.ts:14-145`).
- A instalação tem stepper com `aria-current="step"`, status do Portal e
  estados de execução/recusa/erro (`src/app/pages/install/install.page.ts:33-58`
  e `:252-290`).
- O offline global é anunciado como `role="alert"` e oferece retry
  (`src/app/app.ts:130-136`). O screenshot existente
  `e2e/artifacts/08-offline.png` é evidência visual desse caminho.

### Grafo

- A rota `/graph` existe e o cliente chama `GET /api/v1/graphs`, esperando
  `GraphBundle` com `availability`, `views` e `studio_url`
  (`src/app/core/api/api.client.ts:146-148` e
  `src/app/core/api/api.models.ts:209-220`).
- A tela implementada oferece loading, erro com retry, estado “sem grafo” e,
  quando disponível, uma lista de views com contagem de nós/arestas e link
  externo (`src/app/pages/graph/graph.page.ts:17-59`).
- A implementação atual não embute o Graph Studio nem oferece inspector,
  busca, filtro ou exportação; ela apenas lista metadados e abre
  `studio_url`. Isso diverge da intenção registrada no ADR-004, que descreve
  iframe sandbox e painel inspector (`docs/fase0/architecture.md:60-71`).

### Evidência

- O Task Center renderiza receipts de execução com status, exit code, refusal,
  documento `forge/*`, checks, drift, arquivos, verificação, unlock/repair
  hint e JSON bruto colapsável (`src/app/pages/tasks/tasks.page.ts:100-122` e
  `src/app/shared/forge-doc.ts:47-209`).
- Instalação, profiles, MCP e federation exibem receipts mais resumidos —
  status, detalhe, recusa e, em alguns casos, ações — em vez de reutilizar
  toda a superfície `ui-forge-doc` (`src/app/pages/install/install.page.ts:260-288`,
  `src/app/pages/profiles/profiles.page.ts:32-47`,
  `src/app/pages/mcp/mcp.page.ts:41-56` e
  `src/app/pages/federation/federation.page.ts:277-288`). A paridade de
  evidência entre operações ainda não está demonstrada.

## Loading, error e empty states

| Estado  | Cobertura observada                                                                                                                                                                                                                                                                             | Limite comprovável                                                                                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loading | Bootstrap usa skeleton; federation anuncia loading; instalação e federation anunciam execução; catálogos usam skeleton; grafo usa skeleton (`src/app/pages/dashboard/dashboard.page.ts:14-22`, `src/app/pages/federation/federation.page.ts:38-43`, `src/app/pages/graph/graph.page.ts:24-30`). | `knowledge` e ações de refresh/verify usam apenas `busy`/disabled em parte do fluxo, sem uma região de status visível ou `aria-busy` (`src/app/pages/knowledge/knowledge.page.ts:27-35`, `src/app/pages/mcp/mcp.page.ts:17-35`).                                                     |
| Error   | `ui-error` usa `role="alert"`, mostra código/mensagem e retry; o shell tem banner offline (`src/app/shared/error-state.ts:8-21`).                                                                                                                                                               | Falhas HTTP não-transport durante `refreshHealth()` ficam em `PortalStore.lastError`; essa signal não é consumida pela UI. O dashboard também não tem pending state para o refresh (`src/app/core/portal/portal.store.ts:51-62`, `src/app/pages/dashboard/dashboard.page.ts:47-49`). |
| Empty   | `ui-empty` é honesto e reutilizado para ausência de dados e filtros sem resultado; Graph diferencia `availability` de erro (`src/app/shared/empty-state.ts:6-20`, `src/app/pages/graph/graph.page.ts:53-59`).                                                                                   | A distinção entre “nenhum resultado após busca”, “não carregado” e “capacidade não aplicável” varia por página; não há uma matriz de estados automatizada para todos os endpoints.                                                                                                   |

## Responsividade

Há uma base responsiva consistente: grids usam `auto-fit`/`auto-fill`, o shell
reduz a sidebar para 66px em `max-width: 760px`, o atalho visual `Ctrl K` some
em `max-width: 640px`, o stepper quebra em `max-width: 560px`, e install/
federation têm breakpoints próprios (`src/styles.css:941-952, 1252-1256,
1379-1394`;
`src/app/pages/install/install.page.ts:401-410`;
`src/app/pages/federation/federation.page.ts:514-530`). Existe uma execução E2E
em viewport 390×844 (`e2e/test_browser_e2e.py:477-482`) e o artefato
`e2e/artifacts/07-mobile.png` mostra a composição vertical do dashboard.

Limitações da evidência atual:

- O E2E valida apenas que uma tela mobile foi pintada e captura screenshot; não
  há asserção de ausência de overflow horizontal, tamanho de alvo, ordem de
  foco ou legibilidade em zoom.
- O colapso da sidebar oculta texto e se apoia nos ícones; isso precisa ser
  tratado junto com a lacuna de nome acessível abaixo, não apenas como uma
  decisão visual de mobile.
- A validação de browser registrada cobre Chromium; Firefox/WebKit e zoom de
  200% permanecem fora desta evidência (`docs/final-hardening/fase9-release.md:112-118`).

## Acessibilidade

Aspectos positivos comprováveis: skip link para `#content`, foco visível
global, ícones decorativos marcados como `aria-hidden`, labels associados a
inputs, radiogroups nomeados, alerts/status em fluxos relevantes e respeito a
`prefers-reduced-motion` (`src/app/app.ts:51-68`, `src/styles.css:194-200`,
`1028-1045`, `236-243` e `861-866`, além dos templates de
install/federation).

Gaps de código:

1. **Nome acessível da navegação colapsada.** Os links de navegação não têm
   `aria-label` nem `aria-current`; em `max-width: 760px`,
   `.nav__label` é ocultado, enquanto `ui-icon` é decorativo. Assim, os links
   podem ficar sem nome acessível e o item ativo só é indicado por classe
   visual (`src/app/app.ts:62-69`, `src/app/shared/icon.ts:60-72` e
   `src/styles.css:1379-1394`).
2. **Status do shell dependente de cor/title.** O ponto de status do topbar é
   `aria-hidden="true"` e o estado é colocado apenas em `title`; não existe
   texto equivalente anunciado no topbar (`src/app/app.ts:87-91`).
3. **Estado assíncrono incompleto.** Nem todos os loading/busy states têm
   `role="status"`, `aria-live` ou `aria-busy`; a diferença é observável entre
   federation/install e knowledge/MCP (referências na tabela acima).
4. **Auditoria formal pendente.** O próprio release report registra que uma
   auditoria axe/WCAG ainda não foi executada (`docs/final-hardening/fase9-release.md:116-118`).

## Gaps comprováveis e prioridade documental

| ID    | Achado                                                                                                                              | Evidência                                                                                                                                                                                       | Impacto UX                                                                                     | Ação fora deste commit                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| UX-01 | O frontend pede `/api/v1/graphs`, mas `default_operations()` registra apenas bootstrap, health, capabilities e installation/status. | `src/app/core/api/api.client.ts:146-148`; `portal_core/forge_portal.py:765-781`. O artefato existente `e2e/artifacts/route-graph.png` mostra `no such operation: /graphs` / `PORTAL-NOT-FOUND`. | O usuário recebe erro em vez de estado disponível/indisponível do grafo no adapter local.      | Alinhar o registro da operação e o contrato do adapter; não corrigido por esta auditoria. |
| UX-02 | A tela Graph Studio é só um resumo/link; não há iframe sandbox, inspector, busca, filtro ou exportação.                             | `src/app/pages/graph/graph.page.ts:32-59` versus `docs/fase0/architecture.md:64-71`.                                                                                                            | A promessa “grafo real, evidência e impacto” não se realiza dentro da tela.                    | Decidir se o contrato é atualizado ou se a tela deve receber a experiência prevista.      |
| UX-03 | A superfície de evidência não é uniforme entre operações.                                                                           | `ui-forge-doc` é usado em tasks (`src/app/pages/tasks/tasks.page.ts:120`), enquanto install/profile/MCP/federation usam blocos menores.                                                         | Checks, drift, ações e JSON podem desaparecer dependendo da operação, dificultando comparação. | Definir contrato de receipt visual comum antes de alterar componentes.                    |
| UX-04 | `--bad` é usado no renderer de `forge/*`, mas não existe alias correspondente no token layer; o token disponível é `--error`.       | `src/app/shared/forge-doc.ts:293,312,315`; `src/styles.css:531-532`.                                                                                                                            | Drift ausente e recusas podem perder a cor semântica esperada.                                 | Corrigir o token em código em uma mudança separada, com screenshot/regressão.             |
| UX-05 | Navegação mobile colapsada pode não ter nome/estado acessível.                                                                      | `src/app/app.ts:62-69`; `.nav__label { display:none }` em `src/styles.css:1379-1388`; ícone `aria-hidden` em `src/app/shared/icon.ts:69`.                                                       | Usuários de leitor de tela/teclado podem não identificar destinos ou página ativa.             | Adicionar nome e estado sem depender do ícone; validar com leitor de tela e teclado.      |
| UX-06 | Falha HTTP não-transport de refresh de saúde é armazenada mas não apresentada; refresh não sinaliza pending.                        | `src/app/core/portal/portal.store.ts:51-62`; `src/app/pages/dashboard/dashboard.page.ts:47-49`; única leitura de `lastError` é no store.                                                        | O usuário pode acionar refresh e não saber se falhou ou ainda está em andamento.               | Adicionar estado de refresh e anúncio de erro em mudança de código posterior.             |

## Conclusão

O Portal tem uma base UX útil e honesta para status, loading, erro e vazio,
com boa reutilização de tokens e componentes. A prontidão não deve ser marcada
como completa enquanto UX-01/UX-02 bloqueiam a jornada de grafo e as lacunas
UX-04/UX-05/UX-06 permanecem sem correção. Este commit registra somente os
achados e preserva o estado de código e screenshots recebidos.
