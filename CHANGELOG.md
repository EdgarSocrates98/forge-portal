# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui, no
formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

### Added

- **Installer UX portátil**: instalador animado com UI em stderr e JSON
  puro no stdout (PR #100).
- **Wave 15 — Workspace Control Center / Resource Explorer**:
  - `GET /api/v1/resources` agora reporta `members[]` — membros da
    workspace detectados por marcador (`.git`, `forge.json`,
    `forge.agentic.json`, `pyproject.toml`, `package.json`), incluindo
    membros **sem git**; detecção limitada a 2 níveis, nunca segue
    symlinks/junctions, ignora dirs ocultos e de ferramentas.
  - Entradas de recurso carregam `version`, `domain`, `hosts`, `hash` e
    `integrity` — proveniência declarada pelo manifest; campo ausente
    permanece `null`, nunca inventado.
  - Página `/resources` exibe a faixa de membros e os novos campos;
    `/install` torna explícita a fronteira de delegação (seleção de
    forge/workspace vive em `/federation` e na opção `--root` do servidor).
  - `scripts/vendor.py --check` reporta `checked N of M` + skips como
    `NOT_APPLICABLE`; `--require-all` sai com código 3 quando um checkout
    de destino está ausente; atlas virou módulo opt-in por destino
    (`modules` no manifest FORGES — hoje só the-forge).
  - CLI `forge-portal` deriva a versão de `package.json` (trilha única)
    e `start` não usa mais shell/`npm.cmd` — spawn direto do `ng.js`.
- **AGENTS.md**: contrato de repo para agentes (classificação de host
  vendored, trilha de versão, modelo de segurança, gates).

### Fixed

- Estados de erro honestos, gaps de i18n e drain de keep-alive (#101).
- `.codebase-memory/` deixou de ser rastreado — artefato gerado por
  tooling, nunca deveria ter entrado no histórico.
- `.devin/config.json` não permite mais `forge-portal doctor`, comando
  inexistente — substituído por `status`/`--json status`.

### Docs

- CHANGELOG 1.1.2/1.1.3 reconstruído a partir do git log; `docs/README.md`
  (índice), `docs/troubleshooting.md`, SECURITY.md ampliado
  (`FORGE_CLI_BIN`, modelo de segurança do portal).

## [1.1.3] - 2026-11-12

### Added

- `/resources` — superfície Resource Catalog federada (metadata-only,
  cacheada) + página Resource Explorer com filtros por forja/tipo, busca
  e estados de disponibilidade (#96).
- Barra de progresso de navegação global (#98).

### Fixed

- `/resources` promove `skills[]`/`agents[]` legados a placeholders
  tipados — mesma regra do CLI, catálogo idêntico nos dois hosts (#97).
- `PORTAL_VERSION` sincronizado com `package.json` 1.1.2 (#95).

## [1.1.2] - 2026-11-12

### Added

- Integração code-atlas: probe read-only `GET /api/v1/atlas/status`
  (`forge/PortalAtlasStatus/1` — available/degraded/unavailable, SSRF
  guard loopback-only, opt-in por adapter) + estados de contexto
  granulares na UI (#94).

### Fixed

- Refresh de segurança da toolchain Angular (deps).
- i18n: label do assistente de chat localizado; view-transition agora
  honra o opt-out `data-motion='full'` (#94).

## [1.1.1] - 2026-11-04

### Fixed

- Improved responsive navigation, localized chat and diagnostics actions, and
  honest unavailable/error states for missing portal capabilities.
- Hardened registry CLI discovery, cross-platform homologation and workspace
  context discovery support.

### Programa evo-cli-portal (F0→C5, branches `audit/f0-baseline-squashed`→`cycle/c5-operations`)

#### Added

- **Dashboard 360 + Forja explorer (C3)**: dados reais do adapter
  `forge/PortalApi/1` — estados honestos, sem dados inventados.
- **Install Center 9 passos (C3)**: plano→confirmação→execução via plan
  tokens; verificação; receipts.
- **Config Center + busca global (C3)** e design system unificado
  (i18n pt-BR/en com paridade gateada — 585/585).
- **Host Integration Center `/hosts` (C4)**: estado real por host,
  comando copiável, plano de merge, validação e rollback.
- **MCP Operations Center `/mcp` (C4)**: handshake real sem invocar
  tools; tools/resources/prompts exibidos só com evidência do adapter;
  latência rotulada como HTTP round-trip.
- **Agent Studio `/agents` + Skills Studio `/skills` (C4)**: catálogos
  reais via adapter; colisões marcadas sem merge; runtime capability
  permanece `unverified`.
- **Capability matching `/match` (C4)**: matching sobre metadados do
  catálogo; adapter como árbitro final (refusal codes verbatim).
- **Execution Center `/tasks` (C5)**: histórico de operações + receipts
  com correlation IDs.
- **Observability `/observe` (C5)**: métricas derivadas do histórico do
  adapter (limitação declarada na página).
- **Version Manager `/versions` (C5)**: análise semver de bumps via
  adapter.
- **Graph Studio federado `/graph` (C5)**: overlay federado sobre o
  engine de grafo existente — 7 node kinds, edges só com relações
  reais, evidence tags, nós unverified tracejados, export JSON,
  busca insensível a diacríticos (19 testes).
- **Suíte de segurança `tests/test_security_c5.py` (C5)**: 24 testes —
  sessão, CSRF, origin, host-header/DNS-rebinding, rate limit,
  traversal, symlink, RCE-inerte, SSRF, CRLF, secrets em respostas,
  plan replay/expired/cross-plan, cancelamento, concorrência,
  payload cap.

#### Changed

- Graph export usa `data:application/json` URI (revogação de objectURL
  não é necessária).
- Chips de kind no grafo renderizam tokens de contrato crus (removido
  pipe i18n dinâmico que podia exibir placeholder não resolvido).

#### Fixed

- Adapter api-forge: parsing de frontmatter YAML desdobra block-scalars
  (`>-`, `|`) — keys reais de `name`/`description` extraídas (PR #75).

#### Security

- Servidor loopback endurecido: header de sessão exigido p/ mutação,
  Origin não-loopback rejeitado, form-posts rejeitados, Host-header
  guard, rate limiting em endpoints mutantes, payload cap, plan tokens
  HMAC com hash+expiry, receipts imutáveis.

#### Compatibility

- `forge/PortalApi/1` sem mudança breaking; novos endpoints opcionais —
  ausência vira `unavailable`, nunca erro silencioso nem dado inventado.
- Zero dependências de runtime novas desde F0.

#### Migration

- Nenhuma migração obrigatória. Forjas sem os endpoints novos continuam
  funcionais (estados honestos).

#### Known limitations

- Sessão é binding-only, sem TTL temporal (P2 — decisão de produto).
- Métricas de observability limitadas ao histórico que a Forja relata.
- Warning de budget de estilo em `install.page.ts` (4 kB excedido por
  2.67 kB) — pré-existente, build passa.
- Scenario B: sessão de browser contra Forja real em produção não foi
  re-executada nesta homologação (evidência histórica: 12 E2E Chromium).
