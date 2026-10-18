# Homologação final — Forge Portal 2.1

Fecha o ciclo 6 (`feat/portal-2.1-cycle6`) e consolida a evidência dos
ciclos 0–5 contra a definição de pronto (§12 do `prompt_evo_portal2.md`).
Nada aqui é declaração sem evidência: cada linha aponta para um arquivo,
um teste ou uma medida.

Commit inicial do esforço 2.1: `9f9ca79` (PR #34 — auditoria baseline).
Commit base deste ciclo: `ad9e447` (main pós-PR #40).

## Gates de regressão — resultados desta branch

| Gate | Comando | Resultado |
|---|---|---|
| Unit frontend | `npm test` (Vitest 5.0.3 + jsdom) | **49 arquivos / 493 testes — todos passam** |
| Build produção | `npm run build` (ng, production) | **OK** — initial 369.09 kB raw / 97.50 kB transfer; 0 warnings; budgets `initial` 500 kB/1 MB e `anyComponentStyle` 4 kB/8 kB em vigor (`angular.json` L31–41) |
| Formatação | `npx prettier --check "src/**/*.{ts,html,css}"` | **OK** — all matched files |
| Lint Python | `ruff check .` (0.16.0) | **OK** — all checks passed |
| Testes backend | `python -m pytest tests/ -q` | **154 passed** em 171 s |
| Testes browser | `python -m pytest e2e/ -q` | **43 passed** em 227 s (Chromium real; inclui axe 21 rotas + fluxo federado the-forge) |
| i18n | `python scripts/check_i18n.py` | **OK** — 957 pt-BR / 957 en keys, 630 estáticas usadas |
| Dependências | `npm audit` | **0 vulnerabilidades** |
| Estilo/build budgets | — | em vigor, nenhum excedido |

## Matriz final (§13)

| Área | Antes (baseline #34) | Depois (esta branch) | Evidência | Status |
|---|---|---|---|---|
| UI/UX | Baseline auditada; dívida visual mapeada | Sistema visual de tokens + 21 rotas navegáveis, estados honestos (empty/UNVERIFIED/refusal) | `docs/design/`, captures `docs/design/captures/cycle6/` (97 PNGs, 6 contextos) | PASS |
| Graph Studio | Lista simples | Canvas Cytoscape lazy + 5 layouts + análise de impacto + agrupamento + export SVG + lista equivalente | `docs/architecture/graph-studio-2.1.md`, `scripts/graph-bench.mjs`, spec `graph.page.spec.ts` (20 testes) | PASS |
| Grafos e relações | — | `FedGraph` federado com overlays por forja; edges reais (286@100 n, 4 982@1 k) | benchmark §Performance; `test_theforge_federated_flow` e2e | PASS |
| Animações | — | Tokens `--motion-*`, zero sob `prefers-reduced-motion`; cose roda assíncrono mesmo sem animação | `tokens.css`, fix documentado em benchmarks §2; sem eventos fictícios | PASS |
| Agent Studio | — | Catálogo real agents/skills com view modes, filtros e deep links | `agents.page.spec.ts`, `skills`, e2e | PASS |
| Observabilidade | Sem eventos | `forge/PortalEvent/1` + buffer bounded (500) + `/events` + `/metrics` + timeline + replay real | `portal_core/telemetry.py`, `execution.page`, `observe.page`; custo medido (§Performance) | PASS |
| Integrações | — | Homologação real por forja via subprocess adapter (7 checkouts) | `docs/homologation/README.md` + `cycle-4-matrix.json` | PASS (gaps declarados lá) |
| Acessibilidade | Parcial | axe-core 0 serious/critical em **21 rotas**; ARIA corrigido nas timelines; contraste ≥4.5 medido; zoom 200/400 e reflow sem overflow; alvos <24 px justificados por exceções SC 2.5.8 | `docs/audits/a11y-cycle6.md`, `probe-metrics.json` | PARTIAL→screen-reader manual pendente |
| Segurança | Forte, 1 classe de resposta sem headers | `send_error` coberto; +XFO/Permissions-Policy; matriz §9.1 item a item | `docs/security/portal-2.1-review.md`, `test_security_c5.py` (+3 testes) | PASS |
| Performance | Sem medida portal-wide | Probe CDP real: FCP ≤120 ms, load ≤94 ms (SPA), heap, DOM nodes, Task/Script deltas; bundle 369 kB; cose não-viável ≥5 k (medido) | `docs/perf/portal-2.1-benchmarks.md`, `e2e/artifacts/perf-cycle6.json` | PASS |
| Testes | 449 testes | 493 Vitest + 154 pytest + suite e2e Chromium | §Gates | PASS |

## §12 — definição de pronto, item a item

- Gaps P0 resolvidos: os do baseline (#34) fechados nos ciclos 1–5; o gap
  deste ciclo (send_error sem headers) fechado aqui. **PASS**
- Fluxos críticos com fontes reais: install/plan→confirm→receipt, MCP
  verify, catálogos, federação — todos contra adapters reais. **PASS**
- Graph Studio com nós/arestas reais + inspectors + impacto correto +
  navegação integrada: verificado por specs + e2e federado. **PASS**
- Animações sem eventos fictícios: telemetria emite só em operações
  reais; nenhum evento sintético entra no buffer do usuário. **PASS**
- Dashboard operacionalmente útil + erros com explicação/ação:
  `error-guidance`, recibos com `unlock`, refusal cards. **PASS**
- Responsivo: overflow-x 0 em 6 contextos medidos. **PASS**
- Acessibilidade no escopo definido: **PARTIAL** — automatizado verde;
  screen-reader manual pendente (declarado).
- Segurança preservada + benchmarks registrados: **PASS**.
- Distribuição compatível + forjas independentes:
  `tests/test_independence.py` (stdlib-only, vendored 1-geração de lag,
  zero imports cruzados) — **PASS**.
- Funcionalidades não implementadas declaradas: sim — ver §Itens não
  concluídos.
- Homologação com evidências: este documento + artefatos citados.

## Falhas encontradas neste ciclo e correções

| Falha | Severidade | Correção |
|---|---|---|
| `send_error` do stdlib respondia sem CSP/nosniff/no-store (404s de traversal e assets) | média | Override em `forge_portal.py` L512–549 com escape + headers; teste `TestSecurityHeadersEverywhere` |
| Faltavam `X-Frame-Options` e `Permissions-Policy` | baixa | `_security_headers()` L505–509 |
| `<button role="listitem">` inválido (axe `aria-allowed-role`, minor) em `/execution` e `/tasks` | baixa | Wrapper `<div class="tl__item" role="listitem">` nos dois pages |
| `aria-label` divergente do texto visível (serious `label-content-name-mismatch`, exposto pelo fix anterior) | serious | `aria-label` removido; nome acessível = conteúdo do botão |
| Ticks/barras de timeline transbordavam o track (clip ≤3 px na borda; flag do probe em `/execution`) | baixa | `left` → `clamp(0px, X%, calc(100% - 3px))` nos dois pages; probe re-run com 0 clips |
| axe cobria só 13 rotas | — | 21 rotas em `test_axe_core_audit` |
| Probe perf imprimia contadores cumulativos como deltas | — | `delta()` por navegação; contadores Layout/RecalcStyle sem `*1000` |
| `test_independence` falhava com cópias vendáveis a 1 geração de lag | — | `KNOWN_PREV_GENERATIONS` com janela de exatamente 1 geração |
| Benchmark completo de grafo excedia timeout de comando em 5 k+ | — | Re-run limitado a 100/1 k via `BENCH_SIZES`; limitação ≥5 k documentada, não escondida |

## Itens não concluídos (declarados)

1. **Screen-reader manual** (NVDA/VoiceOver): ambiente sem AT — checklist
   pronto em `docs/audits/a11y-manual-checklist.md`. MANUAL-NEEDED.
2. **Session token sem TTL** — por-boot, loopback-only; aceite
   documentado em `docs/security/portal-2.1-review.md` §Ressalvas.
3. **Redação por nome de chave** (não por padrão de valor) — mesma
   ressalva documentada.
4. **Sem cancelamento de op em flight** — timeout devolve controle; a
   thread termina sozinha (bounded pelo timeout do CLI quando há).
5. **`telemetry` UNSUPPORTED nas 7 adapters irmãs** — a superfície existe
   no portal; vendors só emitem `forge/PortalEvent/1` quando cada forja
   re-vendorar (`docs/homologation/README.md` gap 1).
6. **Mutations = NOT_TESTED por política** na homologação — só o refusal
   boundary é exercitado.
7. **Cose ≥5 k nós não viável** — medido (>120 s); layouts estruturais
   continuam interativos; ferramenta deixa a escolha ao usuário.
8. **Sem estudo de usuário** — §8.5 walkthroughs não foram medidos com
   pessoas; nenhum número de usuário inventado.

## Riscos conhecidos

- Um processo local malicioso do próprio usuário pode ler o session
  token do ambiente — inerente ao modelo local-first; mitigações
  (loopback+SameSite+compare_digest) documentadas.
- `style-src 'unsafe-inline'` permanece (exigência Angular) — aceite.
- Cópias vendáveis dos irmãos levam este hardening na próxima re-vendor
  de cada forja — janela de 1 geração assertada por teste.

## Revisão independente (§13)

Não havia um segundo implementador humano disponível nesta sessão. A
verificação independente foi instrumental: cada afirmação do relatório
está atada a um artefato gerado por ferramenta distinta da implementação
(axe-core, CDP, pytest, Vitest, ruff, prettier, npm audit, check_i18n).
Itens que exigiriam julgamento humano (screen-reader, UX walkthrough)
ficaram **explicitamente não-verificados** em vez de confirmados.

## Recomendações futuras

1. Rodar o checklist de screen-reader em uma máquina com NVDA/VoiceOver.
2. Re-vendor `_forge_portal.py` nos checkouts irmãos para absorver o
   hardening de `send_error`/XFO/Permissions-Policy.
3. Medir walkthroughs de tarefa (§8.5) com instrumentação real antes de
   citar números de UX.
4. Avaliar TTL/renovação de session token se o modelo de ameaça mudar.
5. Se grafos reais passarem de ~1 k nós, investir em layout servidor ou
   renderer alternativo — cose medido como não-viável.

## Artefatos de evidência

- `docs/security/portal-2.1-review.md` — matriz §9.1 linha a linha.
- `docs/audits/a11y-cycle6.md` — WCAG 2.2 AA, camadas automatizadas.
- `docs/audits/a11y-manual-checklist.md` — pendências AT.
- `docs/perf/portal-2.1-benchmarks.md` — rotas, interações, telemetria,
  bundle, grafo; baseline comparada.
- `docs/perf/bundle-baseline.md` — baseline de bundle (regressão).
- `e2e/artifacts/perf-cycle6.json` — medidas brutas do probe.
- `e2e/perf_probe.py` — instrumento reproduzível.
- `docs/design/captures/cycle6/` — 97 capturas (6 contextos × 21 rotas
  + variantes light/zoom).
- `docs/homologation/` — matriz cross-forge do ciclo 4.
