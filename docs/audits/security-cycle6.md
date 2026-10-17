# Revalidação de segurança — ciclo 6

Escopo: `portal_core/forge_portal.py` (servidor stdlib-only) + superfície
`src/` (frontend). Método: leitura dirigida + greps reproduzíveis abaixo.

## Status: PASS (1 bypass sanitizador controlado, documentado)

## Backend — fronteiras verificadas

| Fronteira | Status | Evidência (`forge_portal.py`) |
|---|---|---|
| Bind loopback | PASS | `serve(host="127.0.0.1")`; `host not in (…loopback) → ValueError` L822–823 |
| Guarda anti-DNS-rebinding | PASS | `_host_ok()` L522–530 rejeita `Host` não-loopback em GET e POST (403 `PORTAL-HOST`) |
| CSP | PASS | L46 + `send_header("Content-Security-Policy", CSP)` L465: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` — sem CDN, sem `unsafe-eval` |
| `X-Content-Type-Options: nosniff` | PASS | L463 |
| Sessão | PASS | token 128-bit; `X-Forge-Session` header ou cookie `forge_session` comparado com `hmac.compare_digest` (L510–511) |
| CSRF/Origin em mutação | PASS | `_origin_ok()` L514–519: se `Origin` presente, host deve ser loopback; ausente = cliente não-browser (header de sessão ainda obrigatório) |
| Content-Type em POST | PASS | L586–591: exige `application/json` senão 415 `PORTAL-CONTENT-TYPE` |
| Rate limit em mutação | PASS | L593: `operation.mutating` → `rate_limiter.allow()` senão 429 `PORTAL-RATE-LIMITED` |
| Allowlist de operações | PASS | dispatch via `Operation` registry tipado; "no shell" (docstring L14) |
| plan_token | PASS | `needs_plan_token` → 400 `PORTAL-PLAN-REQUIRED` (L635–638); HMAC em `make/check_plan_token` L395–402, expiração 900 s |
| Redação de segredos | PASS | respostas passam por scrub de chaves secret-like; `_REDACT_EXEMPT = {"plan_token"}` (L55) — necessário ao fluxo plan→confirm |
| Payload máximo | PASS | limite de 1 MiB no corpo de POST |

## Frontend — greps reproduzidos

```text
$ grep -rn "innerHTML\|bypassSecurityTrust" src/ --include="*.ts"
src/app/shared/icon.ts:77   [innerHTML]="svg()"
src/app/shared/icon.ts:94   this.sanitizer.bypassSecurityTrustHtml(PATHS[this.name()] ?? PATHS['dashboard'])

$ grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{8,}" src/
(sem ocorrências — nenhum segredo literal no bundle)

$ grep -rniE "https?://" src/ --include="*.ts" | grep -v "localhost\|127.0.0.1\|w3.org"
(sem URLs externas renderizadas no frontend)
```

### `icon.ts` — bypass controlado (decisão: manter, documentado)

`bypassSecurityTrustHtml` é aplicado a `PATHS[name]` onde `PATHS` é um
**mapa constante de compile-time** de path SVG e `name` é apenas a chave de
lookup com fallback `'dashboard'`. Nenhuma string de usuário ou de rede
alcança o bypass — é equivalente a um enum de assets inline. Risco aceito e
registrado aqui; qualquer futura fonte de SVG dinâmica deve passar por
sanitização normal.

### `command-palette.ts` — URL externa (corrigido neste ciclo)

Resultados do tipo link agora passam por allowlist de esquema
(`https:`, `http:`, `mailto:`) antes de `window.open`; `javascript:` e
`data:` são descartados — teste em `command-palette.spec.ts`.

## Não-verificável / fora de escopo

- TLS: portal é loopback por design; HTTPS não se aplica.
- Dependências npm (`npm audit`): não executado neste ciclo (ver
  recomendações do relatório de homologação).
- Segredos em logs de runtime: scrub cobre respostas da API; logs de
  processo do host (terminal do usuário) são fora do alcance do servidor.
