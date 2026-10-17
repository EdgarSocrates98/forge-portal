# Arquitetura do frontend — forge-portal

Angular 22 standalone, TypeScript estrito, Vitest. Sem NgModules — cada
página e componente é standalone; estado reativo via `signal`/`computed`.

## Shell e páginas

`src/app/app.ts` é o shell: sidebar com nav agrupada por jornada
(`NAV` → `visibleNav` filtra por capability reportada pelo descriptor),
topbar (busca → palette, idioma, tema), `<main id="content">`,
offline banner, command palette, toast outlet e confirm host. A gestão de
foco em navegação vive no construtor (primeiro `NavigationEnd` preserva o
skip link; os seguintes focam `#content`).

17 páginas em `src/app/pages/<nome>/<nome>.page.ts`, todas carregadas por
`loadComponent` em `app.routes.ts` — nenhuma página entra no bundle
inicial.

## Camadas

```
pages/      componentes de rota (apresentação + orquestração local)
core/       api/ catalog/ graph/ i18n/ match/ portal/ search/ session/ theme/
shared/     command-palette, confirm-dialog, toast, page-header, icon,
            state-badge, empty/error-state, filter-bar, skeleton, forge-doc
```

## Fronteira de API

`core/api/api.client.ts` é a única porta para o backend: fala `/api/v1`,
anexa `X-Forge-Session`, desserializa envelopes. O backend
(`portal_core/forge_portal.py`, stdlib-only) expõe um registry de
`Operation` tipadas — o frontend nunca constrói URLs fora do client.

## Abstração de renderer (Graph Studio)

`core/graph/` separa três níveis:

- `federated.ts` — modelo: agrega fontes (`federation`, `graphs`, `mcp`,
  `hosts`, `tasks`) em `FedNode`/`FedEdge` com dedup, evidência e flag de
  disponibilidade por fonte.
- `view-model.ts` — mapeia `FedNode` → nó visual (kind → cor/ícone).
- `renderer.ts` — contrato do renderer; `cytoscape-adapter.ts` é a única
  implementação e é **`import()` dinâmico** — Cytoscape (~121 kB transfer)
  só baixa quando o modo canvas é ativado. A alternativa de lista
  (`.fed__nodes`) não depende de nenhum renderer e carrega a mesma
  seleção via o signal compartilhado `selected()`.

## Stores e serviços (signal-based)

| Store | Responsabilidade |
|---|---|
| `PortalStore` | bootstrap: descriptor, capabilities, health, status online/offline |
| `ThemeStore` | esquema light/dark/system + acento por forja → `data-*` no `<html>`; persiste em localStorage |
| `I18nService` | locale ativa, dicionários lazy (`pt-br`/`en` chunks), pipe `t`, sincroniza `<html lang>` |
| `session` | token de sessão da URL/cookie → header |
| `search` | fontes lazy da command palette (docs, rotas, ops) |

Estado de página fica no próprio componente (signals locais); stores são
só para estado de shell/cross-page.

## Limites de responsabilidade

- **i18n**: toda string user-facing passa pelo pipe `t`; `check_i18n.py`
  trava drift pt-BR/en.
- **tema**: componentes consomem aliases semânticos (`--accent-ink`,
  `--accent-fill`, `--fg`, `--surface`), nunca cores de forja diretas —
  contraste AA é propriedade da camada de tokens.
- **diálogo**: `ConfirmDialog` é o único modal destrutivo (focus trap +
  restore); palette é o único overlay de comando (também com trap).
- **toast**: `ToastStore`/`toast outlet` é o único canal de anúncio
  (`aria-live`).

## Backend local

`portal_core/` roda no processo do usuário, bind loopback, sessão por
token, CSRF por Origin+Content-Type, registry de operações com plan-token
para mutações. Contratos e evidência: `docs/audits/security-cycle6.md`.
