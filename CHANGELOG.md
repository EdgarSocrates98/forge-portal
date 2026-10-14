# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui, no
formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

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
