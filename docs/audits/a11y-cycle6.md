# Auditoria de acessibilidade — ciclo 6 (WCAG 2.2 AA)

Branch `feat/portal-2.1-cycle6`. Escopo: as 21 rotas + shell +
componentes shared. Método, em camadas:

1. auditoria estática programática (`src/app/a11y.spec.ts`, Vitest);
2. **axe-core 4.14 em browser real** (Chromium, `e2e/test_browser_e2e.py`
   `test_axe_core_audit`) sobre as **21 rotas** — ciclo 6 estendeu a
   varredura de 13 para todas as rotas navegáveis;
3. **probe visual real** (`e2e/visual_probe.py` →
   `docs/design/captures/cycle6/`): contraste medido dark/light,
   trilha de foco por Tab, alvos <24 px, texto clipado, overflow
   horizontal em 6 contextos (1920/1366/768/390/light/zoom200/zoom400);
4. inspeção manual de código + contraste calculado por fórmula WCAG.

**Sem teste com leitor de tela** — ver §Limitações.

## Status: PARTIAL→PASS-no-escopo-automatizado (verificação manual com AT pendente)

## Matriz por requisito

| Requisito | Status | Evidência |
|---|---|---|
| axe-core, todas as rotas | PASS (após correção) | `test_axe_core_audit` varre as 21 rotas (`/`, `/install`, `/config`, `/forges`, `/forges/self`, `/match`, `/federation`, `/profiles`, `/hosts`, `/mcp`, `/skills`, `/agents`, `/tasks`, `/graph`, `/observe`, `/execution`, `/lab`, `/versions`, `/knowledge`, `/guide`, `/settings`); falha o teste em qualquer finding `serious`/`critical`. Primeiro run do ciclo 6 expôs **2 serious** `label-content-name-mismatch` (`/tasks`, `/execution`) — corrigidos; run final **0 serious/critical**. |
| Roles ARIA válidos | PASS (corrigido) | Dois achados encadeados nas timelines `/execution` e `/tasks`: (1) `<button role="listitem">` — role proibida em button (axe `aria-allowed-role`, minor) → `role="listitem"` moveu para um wrapper `<div class="tl__item">`; (2) voltando a ser um button de verdade, o `aria-label` (correlation-id completo) não continha o texto visível (shortId) → **serious** `label-content-name-mismatch` → `aria-label` removido; o nome acessível agora deriva do próprio conteúdo do botão. `.tl__row` permanece no botão (seletores de teste intactos). |
| Foco visível | PASS | `:focus-visible` → `var(--focus-ring)` em todos os interativos (`styles.css`); probe Tab-trail por rota: **0 elementos focados sem anel visível** (`focusTrail`/`visible` em `probe-metrics.json`). |
| Contraste AA | PASS (medido) | Probe mediu pares reais em ambos os esquemas: dark mínimo `text-dim/surface` 4.8:1; light mínimo `warn/warn-bg` 4.57:1 — todos ≥4.5:1 para texto; `--accent` (matiz de marca) permanece só em elementos não-textuais (≥3:1). Tabela completa em `probe-metrics.json.contrast`. |
| Keyboard-only | PASS | Skip link → `#content`; nav `aria-current="page"`; dialogs com focus trap + restore (palette + confirm); inspetor de grafo `role="application"` + alternativa de lista equivalente. Testes em `a11y.spec.ts`, `command-palette.spec.ts`. |
| Focus management | PASS | Primeiro `NavigationEnd` preserva foco (skip link); navegações seguintes movem para `<main tabindex="-1">` — `app.ts`, coberto por spec. |
| `prefers-reduced-motion` | PASS | `tokens.css`/`styles.css` zeram durações/transições sob a media query; cose do grafo roda assíncrono **mesmo** sem animação (fix do ciclo 2 — sem ele, `animate:false` rodava `while(loopRet)` síncrono e congelava a aba). |
| Zoom 200%/400% | PASS (medido) | Probe `zoom200-1366`/`zoom400-1366` em `/dashboard`: `overflowX: 0`, sem clip sem-título — layout reflow sem scroll horizontal. |
| Reflow responsivo | PASS (medido) | `overflowX: 0` em **todos** os contextos (w1920/d1366/t768/m390/light/zoom). Tabelas em m390 transbordam **dentro** do container scrollável (`.table` com `overflow:auto`) — padrão correto; nenhum scroll horizontal no nível da página. |
| Texto clipado | PASS (medido) | 0 clips "ruins": todo texto truncado tem `title` (hover/tooltip revela o completo) ou está dentro de scroller (`probe-metrics.json`, regra `not title and not inScroller` = 0 ocorrências). |
| Alvos <24 px | PASS com justificativa WCAG | Probe lista 12 links inline (~68×15 px) e 50 inputs nativos 13×13. Ambos são exceções explícitas do **SC 2.5.8**: (a) links em fluxo de texto — exceção *Inline*; (b) checkboxes/radios **não redimensionados** — exceção *User agent control* (única customização é `accent-color`, que não altera tamanho) **e** o alvo real de ponteiro é a `<label>` que os envolve (`.comp`/`.scope`/`.opt`: `display:flex; padding: 12px` → caixa ≥37 px, largura total; clicar no label ativa o input — comportamento nativo HTML). O probe mede `getBoundingClientRect()` do elemento, não a superfície de ativação — registrado como limitação da heurística, não do produto. |
| Screen reader | MANUAL-NEEDED | Sem AT no ambiente; ver `docs/audits/a11y-manual-checklist.md`. |
| Landmarks/headings/tabelas/dialogs/`aria-live`/`lang`/`aria-current` | PASS | Inalterado desde a correção do ciclo 5 — ver matriz histórica abaixo; cobertura fixada por `a11y.spec.ts` (10 testes). |
| Grafo acessível | PASS | Canvas `role="application"` com `aria-label`, toolbar `role="toolbar"`, lista equivalente com os mesmos dados; inspetores `aria-live="polite"`. Paridade de pan/zoom para AT: não declarada — §Limitações. |

## O que mudou neste ciclo

- **axe 13→21 rotas**: `/forges/self`, `/match`, `/observe`, `/execution`,
  `/lab`, `/versions`, `/knowledge`, `/guide` entraram na varredura
  (`e2e/test_browser_e2e.py` L1108–1114).
- **Dois achados ARIA corrigidos** nas timelines `/execution` e `/tasks`:
  wrapper `role="listitem"` (era role proibida no `<button>`) +
  `aria-label` removido (exposto pelo primeiro fix como serious
  `label-content-name-mismatch`).
- **Clip de ticks/barras nas timelines corrigido**: `.tl__tick` (3 px) e
  `.tl__bar` (`min-width: 3px`) podiam transbordar o track
  (`overflow:hidden`) até 3 px em timestamps na borda direita — o probe
  flagou 5 tracks em `/execution`. `left` passou a
  `clamp(0px, X%, calc(100% - 3px))`: nenhum marcador sai do track.
- **Evidência real substituiu inspeção**: contraste, foco, zoom, reflow e
  clip agora são medidos em Chromium, não inferidos de CSS.

## Matriz histórica (ciclo 5 — itens inalterados)

| Requisito | Status | Evidência |
|---|---|---|
| Landmarks rotulados (`main`/`nav`/`aside`) | PASS | `app.ts` `<nav [attr.aria-label]` + `<main id="content" tabindex="-1">`; grupos `role="group" aria-labelledby` |
| Hierarquia de headings | PASS | único `<h1>` por página via `ui-page-header`; sem pulos de nível |
| Tabelas com `scope` | PASS | `scope="col"`/`scope="row"` em todas as tabelas |
| Diálogos `role="dialog"`/`aria-modal`/focus trap | PASS | `confirm-dialog.ts`; `command-palette.ts` trap + restore |
| `aria-live` em toast/alerts | PASS | `toast.ts` `polite`; erros `role="alert"`; banner offline `role="alert"` |
| Skip link | PASS | `app.ts` → `#content` |
| `lang` do documento | PASS | `i18n.service.ts` sincroniza `<html lang>` com locale |
| URL externa em palette | PASS | allowlist de esquema antes de `window.open` |

## Limitações (declarado, não suposto)

- **Sem leitor de tela disponível no ambiente** — ordem de anúncio,
  verbose de landmarks e experiência real com NVDA/VoiceOver ficam como
  verificação manual pendente (`a11y-manual-checklist.md`). Status desses
  itens: MANUAL-NEEDED, não PASS.
- Grafos no canvas (Cytoscape) dependem da alternativa de lista —
  paridade de informação garantida; paridade de interação pan/zoom não é
  declarada para AT.
- Zoom 200%/400% medido em `/dashboard` (rota representativa densa);
  demais rotas têm a mesma base de layout — generalização é inferida,
  não medida rota a rota.
- Heurística de alvo <24 px mede o `boundingBox` do elemento, não a
  superfície de ativação (label-proxy) — mantida como sinal de
  regressão, não como veredito.
