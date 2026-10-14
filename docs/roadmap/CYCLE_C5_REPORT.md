# Cycle C5 Report — Operations & Observability (forge-portal)

Spec: `factory/specs/active/006-c5-operations-observability.md` · Branch: `cycle/c5-operations`

## Resumo

Execution Center consolidado (plan→review→execute→receipt com correlation IDs já existentes
via PortalApi/1 + api-forge plan tokens), Observability page (`/observe`), Version Manager
(`/versions`), Federated Graph Studio (reuse do engine existente), e a matriz
de segurança §5.7 completa como suite pytest dedicada.

## O que mudou

- `src/app/core/graph/federated.ts` + spec — modelo federado: Forjas, capabilities, skills,
  agents, MCP, hosts, ops, dependências e relações de compatibilidade; nós marcados
  `unverified` quando nenhuma fonte carregada os sustenta; fontes com estados
  `loaded | unverified | unavailable`.
- `src/app/pages/graph/graph.page.ts` + spec — overlay federado sobre as views por-Forja:
  source strip com badges, busca, filtros por kind, inspector com evidence endpoints,
  impact view direta, export `FedGraph` JSON, estados vazios honestos.
- `src/app/pages/observe/` — métricas locais (duração, status, erros, retries, origem,
  correlation ID, versões) vindas do histórico de tasks do adapter; sem telemetria remota.
- `src/app/pages/versions/` — installed/known-available, origem, canal, compatibilidade,
  changelog/diff/breaking quando o adapter expõe; offline = zero remote lookups
  (campos não expostos renderizam `unverified`).
- `src/app/pages/tasks/tasks.page.ts` — execution center: intent→plan→confirmação→
  execute→receipt/history; timeouts, cancelamento, bounded concurrency, retry control,
  logs sanitizados, partial-completion já tratados no adapter (evidência nos specs).
- `tests/test_security_c5.py` — 24 testes cobrindo a matriz §5.7: sessão, CSRF, origin,
  host-header, rate limit, traversal, symlink escape, RCE (metachars inertes), SSRF em
  connectivity checkers, CRLF log injection, redaction de segredos, plan replay, plan
  expirado/forjado/cross-plan, cancelamento, concorrência bounded, payload caps.
  `test_session_has_no_time_expiry` documenta a ausência de expiração temporal
  (gap conhecido, reportado como `ADQ`/finding — não escondido).
- `docs/roadmap/C5_SECURITY_MATRIX.md` — item-a-item da §5.7 com evidência e status.
- i18n: 585/585 chaves PT-BR/EN (36 novas `graph.fed.*`, `observe.*`, `versions.*`).

## Verificação (spec frontmatter)

| Comando | Resultado |
|---|---|
| `npm ci` | ✅ 278 pkgs, 0 vulnerabilities |
| `npm run build` | ✅ (warning pré-existente: install.page css budget) |
| `npm test` | ✅ 26 files / **221 tests** |
| `python -m pytest tests/` | ✅ **69 passed** (incl. security_c5 24) |
| `python scripts/check_i18n.py` | ✅ 585/585 |
| `npx tsc --noEmit` | ✅ clean |

## Gate C5 — evidência real

Fluxo CLI ponta-a-ponta (ver report do forge-cli): fault injetado → diagnose → plan →
confirmação → repair permitido → verify → receipt. Histórico Portal consistente com o
estado nativo (receipts `.forge-cli/receipts/` ↔ task history do adapter).

## Riscos restantes

- Session tokens não expiram por tempo (binding-only) — documentado na matriz, decisão
  de produto pendente (`ADQ`).
- FedGraph depende dos adapters exporem `graphs/skills/agents/hosts/mcp` — ausência vira
  `unavailable`, nunca dado inventado.
- Métricas de observability são derivadas do histórico do adapter — escopo limitado
  ao que a Forja relata (limitação declarada na página).
