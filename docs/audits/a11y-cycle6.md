# Auditoria de acessibilidade — ciclo 6 (WCAG 2.2 AA)

Commit auditado: branch `feat/excellence`. Escopo: as 17 páginas + shell +
componentes shared. Método: auditoria estática programática
(`src/app/a11y.spec.ts`), testes unitários Vitest, inspeção manual de
código e contraste calculado por fórmula WCAG relativa-luminance. **Sem
teste com leitor de tela** — ver §Limitações.

## Status: PARTIAL (PASS estático; verificação manual com AT pendente)

## Matriz por requisito

| Requisito | Status | Evidência |
|---|---|---|
| Foco visível via `--focus-ring` | PASS | `src/styles.css` `:focus-visible` aplica `var(--focus-ring)` em todos os interativos; token em `tokens.css` |
| `prefers-reduced-motion` | PASS | `tokens.css` + `styles.css` zeram durações/transições sob a media query; animações decorativas usam `var(--motion-*)` |
| Landmarks rotulados (`main`/`nav`/`aside`) | PASS | `app.ts`: `<aside class="shell__side">` contém `<nav [attr.aria-label]="'nav.primary' | t">` e `<main id="content" tabindex="-1">`; grupos de nav `role="group" aria-labelledby` |
| Hierarquia de headings | PASS | único `<h1>` por página emitido por `ui-page-header`; varredura: nenhum pulo de nível, nenhum `h5` |
| Tabelas com `scope` | PASS (corrigido) | `scope="col"` adicionado a todos os `<th>` de cabeçalho nas 12 páginas com tabelas; `scope="row"` já existia em row-headers |
| Diálogos `role="dialog"`/`aria-modal`/focus trap | PASS | `confirm-dialog.ts` já completo; `command-palette.ts` ganhou trap de Tab + restauração de foco (testes em `command-palette.spec.ts`) |
| Inspetor de grafo navegável por teclado | PASS | canvas `role="application"` com `aria-label`, toolbar `role="toolbar"`, alternativa de lista equivalente (`fed__nodes`) com mesmos dados; inspetores `aria-live="polite"` |
| `aria-live` em toast/alerts | PASS | `toast.ts` região `aria-live="polite"`, erros `role="alert"`; banner offline `role="alert"` |
| Skip link | PASS | `app.ts` skip link → `#content` (focável via `tabindex="-1"`), estilizado em `styles.css` |
| `lang` do documento | PASS (corrigido) | `i18n.service.ts` sincroniza `<html lang>` com locale (`en`/`pt-BR`) — teste em `i18n.service.spec.ts` |
| Estado da página atual na nav | PASS (corrigido) | `ariaCurrentWhenActive="page"` em cada link de nav; `aria-current="step"` nos steppers (install/hosts) |
| Foco em navegação SPA | PASS (corrigido) | primeiro `NavigationEnd` preserva foco inicial (skip link); navegações seguintes movem foco para `<main>` |
| Contraste de cores AA | PASS (corrigido) | ver §Contraste |
| URL externa em palette | PASS (corrigido) | `command-palette.ts` rejeita esquemas fora de `http(s)`/`mailto` antes de `window.open` |

## Contraste — o que falhava e o que mudou

Auditoria calculada (sRGB → luminância relativa WCAG) sobre todos os pares
token-foreground/background por esquema (light/dark) × 7 acentos de forja.

Falhas reais encontradas **antes** da correção:

- Acentos de forja como **texto** em dark mode: 5/7 abaixo de 4.5:1
  (the-forge, api, platform, doctor-data, doctor-api).
- `--fg-success` light `#0f8a4c`: 4.41:1 sobre `--bg` (< 4.5).
- Texto `--accent-fg` (#fff) sobre fill `--accent`: falhava em
  `spark-forge-aws` (accent âmbar ~2.7:1) e `api`/`platform` em hover.
- `--accent` sobre `--accent-bg` em pills/steps: parcial.

Correção na camada de tokens (`src/styles/tokens.css`), sem tocar a marca:

- Novo `--fg-accent-ink` por forja e por esquema — única variante de acento
  autorizada a pintar texto; todos os valores ≥ 4.5:1 sobre `--bg`/`--surface`
  em ambos os esquemas (verificados por cálculo).
- Novo `--fg-accent-fill` por forja — fill que mantém `--accent-fg` ≥ 4.5:1.
- Aliases `--accent-ink`/`--accent-fill` para consumo em componentes.
- `--fg-success` light `#0f8a4c → #0b7a42` (5.4:1).
- Sweep em 25 arquivos de componente: `color: var(--accent[/strong])` →
  `var(--accent-ink)`; superfícies com texto (`.btn--primary`,
  `.fg-btn[data-variant='accent']`, `.fg-pill[data-tone='accent']`,
  `.chip.on`) migradas para `var(--accent-fill)`.
- `--accent` (matiz de marca) permanece em **elementos não-textuais**:
  bordas, rail da nav, glows, gradientes — onde 3:1 não-texto é exigido e
  o matiz sempre atinge.

## Cobertura estática automatizada

`src/app/a11y.spec.ts` (10 testes) fixa: skip link → `#content`, landmarks,
`aria-current`, heading único, `scope` em tabelas, `aria-live` em toasts,
traps nos dois diálogos, alternativa de lista no grafo, `lang` sincronizado.

## Limitações (declarado, não suposto)

- **Sem leitor de tela disponível no ambiente** — ordem de anúncio, verbose
  de landmarks e experiência real com NVDA/VoiceOver ficam como
  verificação manual pendente. Status desses itens: MANUAL-NEEDED, não PASS.
- Contraste validado por cálculo sobre tokens; screenshots/zoom 200%/400%
  e reflow em viewport real não foram medidos.
- Grafos no canvas (Cytoscape) dependem da alternativa de lista — paridade
  de informação garantida, paridade de interação de pan/zoom não é
  declarada para AT.
