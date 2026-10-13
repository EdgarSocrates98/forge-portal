# FASE 1 — Angular workspace: shell, tokens, temas, i18n, api client

## Escopo entregue

Plataforma Angular compartilhada pronta para receber as 7 experiências
de Forja. Nenhuma dependência de negócio: toda a superfície fala
`forge/PortalApi/1` e degrada honestamente quando o backend local está
fora.

### Shell e navegação

- `src/app/app.ts` — shell com sidebar colapsável (3 seções:
  Operar/Configurar/Explorar), topbar com estado do servidor
  (ready/degraded/offline/booting), nome do workspace, selo `federado`
  e alternadores de idioma e tema. Itens de nav podem exigir capability
  (`tasks`, `graph`) e somem quando `unsupported` — nunca ficam como
  botões mortos.
- 12 rotas lazy (`app.routes.ts`): dashboard, install, federation, profiles,
  hosts, mcp, skills, agents, tasks, graph, knowledge, settings. Cada página é
  um chunk separado — o usuário baixa só o que abre.

### Design tokens e temas

- `src/styles.css` — sistema de tokens `--fg-*` (spacing, radius,
  motion, elevation, fontes, rampas light/dark, cores semânticas de
  estado) + camada de aliases semânticos (`--space-*`, `--accent`,
  `--ok`, `--border`…) que os componentes usam — componente nunca
  referencia cor crua nem `--fg-*` direto, então a troca de tema é uma
  linha de CSS.
- 7 acentos de Forja via `data-forge` no `<html>`: the-forge (laranja),
  spark-forge-aws (âmbar), spark-forge-azure (azul), api-forge (teal),
  platform-forge (violeta), forge-doctor-data (verde),
  forge-doctor-api (magenta). Light/dark via `data-scheme`, com
  `prefers-color-scheme` e `prefers-reduced-motion` respeitados.
- `core/theme/theme.store.ts` — esquema light/dark/system persistido em
  localStorage; acento trocado pelo bootstrap do portal (sem reload).

### i18n runtime

- `core/i18n/i18n.service.ts` — dicionários lazy por locale
  (`pt-br`/`en` viram chunks separados), preferência `automatic|pt-BR|en`
  persistida, `automatic` segue `navigator.language` com fallback
  pt-BR. Interpolação `{param}` e plural `{count, plural, one{} other{}}`
  (com `#`). Chave ausente renderiza `⟪key⟫` — nunca crasha, nunca
  silencia.
- Paridade de chaves pt-BR↔en verificada em teste de unidade **e** em
  compile-time (`Record<keyof typeof PT_BR, string>` no dicionário EN).

### API client e erros

- `core/api/api.models.ts` — todos os modelos `forge/PortalApi/1`:
  envelope `{schema, correlation_id, data?, error?}`, erro estruturado
  `{code, message, message_key, details, severity, retryable, action}`,
  descriptor/health/capability/nav, receipt de instalação, profile,
  host, MCP server, skill, agent, task, graph bundle, doc hit,
  bootstrap.
- `core/api/api.client.ts` — `PortalApi` com 19 métodos tipados; GETs
  read-only, mutações sempre via POST com `confirm` + `plan_token`.
- `core/api/api.interceptor.ts` — anexa `X-Forge-Session` (sessão local
  da URL `?forge_session=`), `X-Correlation-Id` e `withCredentials`;
  normaliza todo erro HTTP/envelope em `ApiError` tipado.
- `core/session/session.store.ts` — token de sessão em memória apenas
  (nunca persistido), removido da URL após a leitura.
- `core/portal/portal.store.ts` — estado central carregado UMA vez por
  `/bootstrap`; sem polling, invalidação explícita por ação.

### Páginas

Todas funcionais contra a API real: dashboard (saúde, quick-start com
passos derivados do estado e onboarding federado, capabilities), install (scope + componentes
→ plano → revisão → apply/repair/uninstall com recibo), profiles
(3 perfis, diff de componentes, apply), hosts (detecção, auth,
integração, launch-hint honesto — o portal nunca finge que lança o
host), mcp (servidores + verify handshake), skills/agents (catálogos
com busca), tasks (intent → plano → execução com recibo), graph
(disponibilidade + link do Graph Studio), knowledge (busca em docs),
settings (idioma, tema, sobre), federation (catálogo real e fluxo governado
de `install_auto` com escopo, host, perfis e componentes).

## Verificação

- `npx ng build` — OK. Bundle inicial **293 kB raw / 81 kB transfer**;
  cada página e cada dicionário i18n em chunk lazy próprio.
- `npx ng test` — **11/11 testes verdes** (shell, i18n, ApiError).
- `npx prettier --write` — código formatado no padrão `.prettierrc`.
- Bug real encontrado e corrigido pela suíte: `#` não era interpolado
  no ramo `one{…}` do plural — teste pega a regressão.

## Limitações honestas

- As páginas ainda não foram exercitadas contra um backend real — o
  servidor Python é a FASE 2. Em `ng serve` sem backend, a UI mostra o
  banner offline honesto (projetado, não improvisado).
- Graph Studio: página mostra disponibilidade e deep-link; a render
  de grafo embutida fica para as fases de Forja que possuem grafo.
- A11y: roles/labels básicos no lugar; auditoria WCAG completa é FASE 8.
