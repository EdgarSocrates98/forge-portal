# Baseline de bundle — ciclo 6

Medido com `npx ng build` (produção) na branch `feat/excellence`, 2026-10-17.
Sem otimização especulativa: este documento é a medida, não uma meta.

## Initial (tela de boot)

| Chunk | Raw | Transfer estimada |
|---|---:|---:|
| `main-TLBCZRZD.js` | 324.10 kB | 87.65 kB |
| `styles-U2JYGPOX.css` | 28.26 kB | 5.33 kB |
| **Total inicial** | **352.35 kB** | **92.98 kB** |

## Lazy (sob demanda)

| Chunk | Raw | Transfer estimada |
|---|---:|---:|
| cytoscape-adapter | 448.51 kB | 121.45 kB |
| tasks-page | 41.29 kB | 9.69 kB |
| install-page | 39.05 kB | 8.65 kB |
| pt-br (locale) | 37.09 kB | 9.94 kB |
| en (locale) | 34.97 kB | 8.79 kB |
| dashboard-page | 32.59 kB | 7.63 kB |
| agents-page | 31.33 kB | 7.79 kB |
| knowledge-page | 29.46 kB | 7.48 kB |
| (shared) `chunk-ByTHT1ej` | 29.18 kB | 7.01 kB |
| graph-page | 24.12 kB | 6.29 kB |
| mcp-page | 23.28 kB | 5.59 kB |
| federation-page | 19.87 kB | 4.52 kB |
| hosts-page | 17.85 kB | 4.86 kB |
| skills-page | 15.47 kB | 4.50 kB |
| forge-detail-page | 15.16 kB | 4.07 kB |
| +17 lazy chunks menores | — | — |

Todas as 17 páginas são `loadComponent` lazy (`app.routes.ts`); Cytoscape
só é baixado quando o modo canvas do Graph Studio é ativado
(`graph-cytoscape.adapter.ts`), e os dicionários i18n são lazy por locale.

## Avisos de budget (existentes, registrados)

- `install.page.ts` component CSS: 6.69 kB (budget 4.00 kB) — excede 2.69 kB.
- `tasks.page.ts` component CSS: 5.63 kB (budget 4.00 kB) — excede 1.63 kB.
- `hosts.page.ts` component CSS: 4.01 kB (budget 4.00 kB) — excede 0.01 kB.

São avisos de estilo de componente, não de bundle JS; nenhuma página pesa
mais que o chunk lazy mediano +9 kB de transferência.

## Re-medida — ciclo 6 (2026-10-18, `feat/portal-2.1-cycle6`)

`ng build` produção: **initial 369.09 kB raw / 97.50 kB transfer**
(4 arquivos: `main` 43.31 + chunk compartilhado 281.68 + `styles` 39.49
+ chunk 4.61); lazy 1 045 kB em 37 arquivos (cytoscape 453.03 kB é o
maior e continua lazy). **0 warnings de budget** — os avisos de CSS de
componente da linha anterior desapareceram porque os estilos foram
consolidados em `styles.css` global (não sujeito a `anyComponentStyle`).

Comparação com a medida original acima: +16.74 kB raw (+4.8%) de
initial — superfície acumulada dos ciclos 3–5 (execution, explorer,
knowledge). Abaixo do limiar de justificativa (~400 kB raw) definido
neste próprio documento e muito abaixo do budget Angular (warn 500 kB).

## Avaliação

- **92.98 kB de transferência inicial** é aceitável para um painel admin
  local-first servido por loopback (a latência de rede é ~0); o peso real
  fica no chunk Cytoscape, que **já é lazy** e não entra no caminho feliz.
- Maior oportunidade futura, caso se meça necessidade: code-splitting de
  Cytoscape por módulo ou renderer alternativo leve — **não executado**
  porque não há medida de impacto em usuário (regra: não otimizar sem medida).
- Recomendação: usar este arquivo como baseline de regressão — qualquer PR
  que eleve o initial acima de ~400 kB raw deve justificar ou dividir.
