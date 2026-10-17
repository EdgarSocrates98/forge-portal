# Portal 2.1 — Cycle 1 UX Review (Visual Excellence & UX Polish)

Data: 2026-10-17 · Branch: `feat/portal-2.1-cycle1` · Auditor: Devin CLI

Escopo: prompt_evo_portal2.md §4.1–§4.7. Auditoria visual em navegador real
(Chromium via Playwright) contra `PortalServer` + `E2EAdapter`, mais uma
variante densa (`AuditAdapter`: ids longos, task falha, MCP degradado, host
ausente) para estressar truncamento e estados honestos.

## Método

| Etapa                                                | Ferramenta                                     | Evidência                                                  |
| ---------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Capturas                                             | `e2e/visual_audit.py`                          | `docs/design/captures/cycle1/*.png` + `audit-metrics.json` |
| Sondas (contraste, clip sem title, alvos, foco, axe) | `e2e/visual_probe.py`                          | `probe-metrics.json`                                       |
| axe-core 4.14 por rota                               | `e2e/test_browser_e2e.py::test_axe_core_audit` | `e2e/artifacts/axe-report.json`                            |
| Suite E2E                                            | `pytest e2e/`                                  | 25 passed (~98 s)                                          |

Matriz de captura (194 PNGs, 97 por variante `base`/`dense`):

- Viewports: 1920×1080, 1366×768, 768×1024, 390×844 — **19 rotas × 4 = 76**.
- Tema claro: as **19 rotas** a 1366×768 (antes: apenas 6 rotas).
- Zoom: `/dashboard` a **200% e 400%** via CSS `zoom` (reflow real).

## Resultado quantitativo

| Métrica                                                     | Resultado                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Overflow horizontal (`scrollWidth − innerWidth > 1px`)      | **0 em 194 capturas** (inclui zoom 400%)                                                |
| Texto clipado sem `title` fora de scrollers                 | **0** — único item residual é `span.tl__track` (trilho de barra da timeline, sem texto) |
| Contraste do palette (19 pares, dark+light, ambos adapters) | mín. **4,57:1** (`--fg-warning`/`--fg-warning-bg`, light) — todos ≥ 4,5 AA              |
| Foco visível (10 Tabs reais por rota × 2 variantes)         | **0** elementos focados sem ring                                                        |
| axe serious/critical por rota                               | **0** (relatório consolidado: 13 rotas, 0 violações)                                    |
| Alvos < 20×20 px                                            | ver "Sub-alvos" abaixo — todos dentro de label ou exceção inline WCAG                   |

### Sub-alvos (probe flags, avaliados um a um)

- `input[type=checkbox]` 13×13 em `/install`, `/federation`, `/settings` —
  todos dentro de `<label>` (o alvo efetivo é a linha inteira).
- `a.linklike` 16 px de altura em células de tabela (`/mcp`, `/tasks`,
  `/dashboard`, `/skills`) — links inline dentro de texto, exceção explícita
  do WCAG 2.5.8; `min-height: 24px` foi aplicada onde o contexto permite
  (linhas de inventário, controles de painel).
- `span.tl__track` clipado sem title: elemento gráfico (trilho do barra),
  sem conteúdo textual; o rótulo `.tl__label` ao lado carrega `title`.

## Correções aplicadas neste ciclo

### Visual / a11y (achados do probe inicial → verificação final)

1. **Contraste `text-dim` no tema claro** — `--fg-text-dim` `#6b7280 →
#646c78` (`src/styles/tokens.css`). Agora 5,31:1 sobre surface e 4,86:1
   sobre bg (antes < 4,5 em bg).
2. **Nós UNVERIFIED sem legibilidade** — Graph e Knowledge usavam `opacity`
   que derrubava o contraste do rótulo. Substituído por borda tracejada +
   fundo translúcido `var(--fg-unverified-bg)`.
3. **Truncamento sem fallback** — `title` adicionado em labels clipados:
   Knowledge (`.node__label`, `.node__id`), Graph (`.fed__label`,
   `.fed__id`), Tasks (`.tl__label`), células de correlação (`.corr`).
4. **Alvos compactos** — links de inventário e `.more` do dashboard com
   `min-height: 24px` + hover; `.icon-btn` da tabela de hosts com 24×24.
5. **`.fg-pill` interativa inerte** — `cursor`, hover, `:active` (scale
   0,97), `:disabled`, transições nos tokens `--fg-motion-*`; `.fg-pill`
   estático (`span`) permanece inerte.
6. **`.chip`/`.chip-link` duplicado por página** — consolidado em
   `src/styles.css`; páginas mantêm apenas o offset local.
7. **Entrada de painéis** — `.fg-enter` (reusa `fg-page-in`,
   `--fg-motion-med`) nos detail cards de tasks/skills/graph/knowledge/mcp;
   desligado em `prefers-reduced-motion`.
8. **Hover em itens de lista** — `.fed__node`, `.node`, `.hit`, `.rec`,
   `.tl__row`, `.replay__step` ganharam transição border/box-shadow com os
   tokens de motion; todos colapsam a 0 ms sob reduced-motion.

### §4.4 Navegação contextual — somente campos reais do modelo

Helper novo `src/app/core/graph/entity-link.ts` (`entityLink()`): mapeia
kind→rota-que-existe, retorna `null` para `capability` (sem página própria —
não inventa link). Conexões implementadas:

| Origem                            | Destino                         | Evidência no modelo                              |
| --------------------------------- | ------------------------------- | ------------------------------------------------ |
| nó `forge:*` (graph/knowledge)    | `/forges/:id`                   | `ForgeDescriptor.id`                             |
| nó `skill:*`                      | `/skills?q=<id>`                | input `q` já existente                           |
| nó `agent:*`                      | `/agents?q=<id>`                | input `q` já existente                           |
| nó `mcp:*`                        | `/mcp?server=<id>`              | novo input `server`                              |
| nó `host:*`                       | `/hosts#host-<id>`              | cards ganharam `id` + `:target` ring             |
| nó `operation:*`                  | `/tasks?task=<id>`              | novo input `task`                                |
| skill detail → "Declaring agents" | `/agents?q=<name>`              | `agents.skills[]` declarado                      |
| agent detail → chip de skill      | `/skills?q=<skill>`             | `AgentDescriptor.skills[]`                       |
| agent detail → chip de host       | `/hosts#host-<h>`               | `AgentDescriptor.hosts[]`                        |
| MCP registry + inspector → host   | `/hosts#host-<host>`            | `McpServerDescriptor.host` (só quando declarado) |
| task detail → eventos             | `/observe?cid=<correlation_id>` | só quando `correlation_id` presente              |
| dashboard linhas de task          | `/tasks?task=<id>`              | `TaskExecution.id` real                          |

Deep links (`?task=`, `?server=`) aplicam **uma vez por valor** (`deepApplied`)
— fechar o card não é desfeito por refresh de fundo; id sem registro é
ignorado sem seleção fabricada. `withInMemoryScrolling(anchorScrolling,
scrollPositionRestoration)` habilitado em `app.config.ts` para que `#host-*`
funcione.

### §4.5 Dashboard acionável

- Cada linha de "recent tasks" agora é um link real para `/tasks?task=<id>`
  (abre o detail card + replay do registro). Teste unitário confirma a ordem
  e os hrefs.

## Revisão por rota (capturas de referência: `base__{w1920|d1366|t768|m390|light1366}__<rota>.png`)

| Rota                                                       | Achados                                                                                | Estado |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ |
| /dashboard                                                 | path do workspace clipa com `title`; tasks agora acionáveis; zoom 200/400 sem overflow | OK     |
| /install                                                   | checkboxes label-wrapped; plano explícito preservado                                   | OK     |
| /config                                                    | sem overflow; env vars legíveis                                                        | OK     |
| /forges (+/self)                                           | "Ver detalhes" sr-only clipa por design; path com title                                | OK     |
| /match, /federation, /profiles, /lab, /versions, /settings | sem achados no probe; badges/UNVERIFIED intactos                                       | OK     |
| /hosts                                                     | `#host-<id>` anchors + `:target` ring; unbound não linka                               | OK     |
| /mcp                                                       | host→`/hosts#` só quando declarado; `?server=` inspector; chips de estado intactos     | OK     |
| /skills                                                    | `?q=` seed + "Declaring agents" link; UNVERIFIED de campos não expostos preservado     | OK     |
| /agents                                                    | `?q=` seed; skills/hosts do detail viram links declarados                              | OK     |
| /tasks                                                     | `?task=` seleciona 1×; linha é link real; `corr` com title; replay estados honestos    | OK     |
| /graph                                                     | inspector "Open in" só p/ kinds com página; capability sem link fake; labels com title | OK     |
| /knowledge                                                 | idem graph; `.node__label/.node__id` com title                                         | OK     |
| /observe                                                   | `?cid=` seed do filtro de correlação; placeholders honestos                            | OK     |

## Pendências honestas (UNVERIFIED / limitações)

- **Screen reader real (NVDA/Orca/VoiceOver): UNVERIFIED** — nenhum
  disponível neste host; checklist manual em `docs/audits/a11y-manual-checklist.md`.
  axe-core + trilha de foco cobrem a parte automatizável apenas.
- **Zoom 400%**: capturado em `/dashboard` (reflow via CSS zoom). Demais
  rotas a 400% ficam como cobertura parcial — 200% + 390px proxy indicam o
  comportamento, mas não substituem verificação visual por rota.
- **Tema HC/system**: tokens existem, mas a matriz desta rodada cobriu
  dark/light; HC fica para revisão manual.
- **`tl__track` clipado sem title**: elemento não textual — aceito, mas
  registrado para revisão caso a trilha ganhe conteúdo.
- **Capturas estáticas**: interações (hover/press/focus) são verificadas via
  probe/JS e unit tests, não via screenshots de cada estado.
- Grafos canvas (Cytoscape) excluídos do detector de overflow/clipping
  (raster); a lista acessível cobre a mesma informação.

## Critérios de aceite §4.7

| Critério                        | Resultado                                                  |
| ------------------------------- | ---------------------------------------------------------- |
| Nenhum overflow crítico         | PASS — 0/194                                               |
| Nenhum controle sem feedback    | PASS — pills/links/rows com hover+focus+press              |
| Nenhum botão fictício           | PASS — links só onde o modelo sustenta; UNVERIFIED visível |
| Navegação contextual            | PASS — tabela acima, tudo model-backed                     |
| Design consistente              | PASS — chips/tokens consolidados                           |
| Responsividade                  | PASS — 4 viewports, 0 overflow                             |
| Temas                           | PASS — dark+light nas 19 rotas                             |
| A11y automatizada               | PASS — axe 0 violações, foco com ring, contraste AA        |
| Pendências manuais documentadas | PASS — seção acima                                         |
| Capturas anexadas               | PASS — `docs/design/captures/cycle1/`                      |

## Gates

| Gate                    | Resultado                                           |
| ----------------------- | --------------------------------------------------- |
| `npx ng test`           | **404 passed** (40 arquivos)                        |
| `npx ng build`          | OK, **zero warnings** (budget de estilos resolvido) |
| `pytest tests/`         | **87 passed**                                       |
| `pytest e2e/`           | **25 passed** (Chromium real, ~98 s)                |
| `scripts/check_i18n.py` | 790 pt-BR = 790 en, 518 keys usadas                 |
| `prettier --check`      | clean                                               |
| axe (e2e + probe)       | 0 violações serious/critical                        |
