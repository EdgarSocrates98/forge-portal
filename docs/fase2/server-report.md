# FASE 2 — `forge_portal.py`: servidor local stdlib vendored

## Escopo entregue

`portal_core/forge_portal.py` (~700 linhas, **zero dependências além da
stdlib**, Python ≥3.11) — o módulo canônico que cada Forja venderá como
`src/<pkg>/_forge_portal.py`, mais `scripts/vendor.py` para propagação
byte-parity e a suíte pytest que exercita a matriz de segurança
inteira.

## Desenho

- **Zero conhecimento de Forja.** O servidor conhece só HTTP, sessão,
  segurança, envelope, tokens e assets. Cada Forja fornece um
  `PortalAdapter` (classe base no módulo) que registra `Operation`s
  tipadas mapeando para seus serviços reais — nenhum shell, nenhum
  comando arbitrário.
- **Operation registry**: `Operation(method, path, handler, mutating,
  confirm, needs_plan_token, timeout)`. Paths aceitam `{param}` —
  `"/tasks/{task_id}/events"`. Operação fora do registry → 404 nomeado.
- **Envelope único** `{schema: "forge/PortalApi/1", correlation_id,
  data|error}` em toda resposta `/api/v1/*`; `X-Correlation-Id` ecoado
  ou gerado.
- **Erros estruturados**: `PortalError(code, message, http, severity,
  retryable, action, message_key, details)` — `code` estável nunca
  traduzido, `message_key` alimenta o i18n do cliente.
- **Plan tokens**: HMAC-SHA256 sobre o plano canonicalizado
  (`json sort_keys`) + timestamp + nonce; `check_plan_token` exige
  match de hash do plano, assinatura e janela de 15 min. Violação →
  `PORTAL-PLAN-STALE` (409).
- **SSE**: handler retorna `SseResult(iterável)` → `text/event-stream`
  com cada evento redigido; desconexão do cliente tratada.
- **Timeout por operação**: handlers rodam num pool de 8 workers;
  estouro → `PORTAL-TIMEOUT` 504 retryable.
- **`serve(adapter)`** — entry point bloqueante para `<cli> portal`:
  bind, porta livre, URL de sessão, `webbrowser.open` best-effort.

## Segurança (matriz FASE 0 implementada, não só documentada)

| Controle | Implementação |
|---|---|
| Bind | loopback only — `ValueError` se `host` ≠ 127.0.0.1/localhost/::1 |
| Sessão | token 192-bit por run; `X-Forge-Session` exigido em todo `/api`; cookie `SameSite=Strict; HttpOnly` plantado via `?forge_session=` e verificado se presente |
| CSRF | `Origin` loopback-allowlist (ausente = cliente não-browser, ok) + `Content-Type: application/json` obrigatório em POST + header custom (não forjável por form) |
| GET | nunca muta — ops `mutating=True` só existem como POST |
| Mutação | `confirm` literal por op + `plan_token` assinado quando exigido |
| Payload | >1 MiB → dreno até 8 MiB + 413 `Connection: close` (drenar evita RST cego no Windows) |
| Rate | 10 POSTs mutáveis/min por processo → 429 `PORTAL-RATE-LIMITED` |
| Estático | só `assets_dir` com resolve+prefix check; `..` → 404; SPA fallback `index.html` para rotas sem extensão |
| Headers | nosniff, Referrer-Policy no-referrer, CSP estrito (`default-src 'self'`, `frame-ancestors 'none'`), Cache-Control no-store |
| Redação | chaves `*token*|*secret*|*password*|*cookie*|*authorization*|*api_key*|*credential*` → `«redacted»`, com allowlist `_REDACT_EXEMPT` para `plan_token` (client-usável por desenho) |
| Erro interno | 500 genérico — tipo da exceção só vai para o log do servidor |

## Bugs reais encontrados pela suíte

1. **`plan_token` era redigido pela scrub** — a operação plan→apply
   nunca fecharia roundtrip. Fix: `_REDACT_EXEMPT` documenta que o
   token é client-usável por desenho (não é segredo — é capacidade).
2. **413 cego resetava a conexão no Windows** — responder antes de ler
   o corpo faz o winsock abortar antes do cliente ler a resposta. Fix:
   dreno limitado + `Connection: close`.
3. **Servidores per-test em portas efêmeras sofriam RST stale** entre
   testes no Windows. Fix na suíte: servidor compartilhado no módulo
   (também exercita keep-alive real) + reset de estado por teste.

## Verificação

- `python -m pytest tests/ -q` → **29/29 verdes em ~1.4s**: envelope,
  sessão (403 ausente/errada), origin (403 cross / 200 loopback),
  content-type (415), payload (413), bad JSON (400), confirm (400),
  plan required (400), plan stale (409), roundtrip plan→apply (200),
  rate limit (429 no 11º), timeout (504), SSE (2 eventos), estático
  (index, traversal ×3, SPA fallback, cookie de sessão), redação,
  security headers, bind-loopback (`ValueError`), token unit
  (roundtrip/tamper/garbage).
- `python -m ruff check portal_core/ scripts/ tests/` → **limpo**.

## Distribuição (scripts/vendor.py)

`python scripts/vendor.py [--repo X] [--check]` copia
`forge_portal.py` → `src/<pkg>/_forge_portal.py` e
`dist/…/browser/` → `portal/assets/` em cada irmão, escrevendo
`portal/manifest.json` (`forge/PortalAssets/1`: sha256+bytes por
arquivo + `portal_version`). `--check` é o gate de drift (exit 1 em
divergência). Verificado rodando `--check` real contra spark-forge-aws.

## Limitações honestas

- Adapter de verdade (serviços reais) vem por Forja nas FASEs 3–7 —
  aqui só o `PortalAdapter` base + `default_operations` (bootstrap/
  health/capabilities/installation-status).
- SSE é um stream por request; sem backpressure além de flush — ok
  para volume de tool local.
- `Connection: close` não é emitido em respostas normais — keep-alive
  HTTP/1.1 funciona; urllib/browser lidam.
