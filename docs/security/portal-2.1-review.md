# Revisão de segurança — Forge Portal 2.1 (checklist §9.1 do ciclo 6)

Branch: `feat/portal-2.1-cycle6`. Commit base: `ad9e447` (main pós-ciclo 5).
Escopo: `portal_core/forge_portal.py` (servidor stdlib-only),
`portal_core/registry_ops.py` (única fronteira de exec), `portal_core/telemetry.py`
e a superfície `src/` (Angular 22, bundle `dist/` servido pelo próprio portal).
Método: leitura dirigida linha a linha, greps reproduzíveis, suite
`tests/test_security_c5.py` e probes reais de resposta HTTP.

Complemento: `docs/audits/security-cycle6.md` (matriz original do ciclo,
escrita antes desta revalidação) e `docs/roadmap/C5_SECURITY_MATRIX.md`.

## Status: PASS com ressalvas declaradas (§Ressalvas)

Nenhuma proteção existente foi enfraquecida. Duas melhorias entraram
neste ciclo:

1. **`send_error()` agora carrega os security headers.** A página de erro
   do stdlib (404 de traversal, 404 de asset ausente, 400 de request
   malformada) era a única classe de resposta sem CSP/nosniff/no-store.
   `PortalHandler.send_error()` foi sobrescrito
   (`portal_core/forge_portal.py` L512–549): corpo HTML genérico com
   `html.escape` em message/explain, `Content-Type`, `Content-Length`,
   `Connection: close` e `_security_headers()`. Regressão:
   `TestSecurityHeadersEverywhere` em `tests/test_security_c5.py`.
2. **`X-Frame-Options: DENY` + `Permissions-Policy`** adicionados a
   `_security_headers()` (L505–509). XFO é o fallback legado do CSP
   `frame-ancestors 'none'` (webviews antigos); a Permissions-Policy
   desliga câmera/microfone/geolocalização/pagamento/USB/FLoC/topics —
   superfícies que o app nunca chama.

## Matriz §9.1 — item a item

| Item §9.1 | Status | Evidência (linhas no `forge_portal.py` desta branch) |
|---|---|---|
| Loopback-only | PASS | `serve()` recusa bind fora de loopback: `raise ValueError("portal binds loopback only")` L980; `host` validado contra o conjunto loopback L977–980. Sem flag de listen externo. |
| Sessões | PASS | Token `secrets.token_urlsafe(24)` (192 bits) por boot, L982; `_session_ok()` L588–601 compara `X-Forge-Session` e/ou cookie `forge_session` com `hmac.compare_digest` (tempo constante). **Ressalva:** token vale pelo tempo de vida do processo — sem TTL próprio (ver §Ressalvas). |
| Cookies | PASS | `forge_session=<token>; SameSite=Strict; HttpOnly; Path=/` emitido uma vez em `GET /?forge_session=…` L901; sem `Secure` porque o transporte é http-loopback por design (TLS não se aplica). Cookie só autentica se o header não decidir (L593–597). |
| CSRF | PASS | Três camadas: cookie `SameSite=Strict` (browser não anexa em POST cross-site), `_origin_ok()` rejeita `Origin` não-loopback em POST (L603–608, enforcement L687–694) e a sessão continua obrigatória — um POST cross-site sem token morre em `PORTAL-SESSION` antes de qualquer op. |
| CSP | PASS | L51–58 + emitido por `_security_headers()` L497–510 em **todas** as classes de resposta após a correção de `send_error`: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Sem CDN, sem `unsafe-eval`, sem `unsafe-inline` em script. `'unsafe-inline'` em `style-src` é exigência do Angular inline-styles — aceito e documentado desde o ciclo 5. |
| CORS | PASS | **Nenhum** header `Access-Control-*` é emitido em nenhum caminho (grep: zero ocorrências) — deny-by-default; o browser bloqueia leitura cross-origin mesmo que um Origin estranho passe. Preflight `OPTIONS` não é implementado → cai em `send_error`/404. |
| Origin validation | PASS | `_origin_ok()` L603–608: `Origin` presente → hostname deve ser loopback; ausente → tratado como cliente não-browser (sessão por header continua obrigatória). Enforcement em todo POST L687–694 → 403 `PORTAL-ORIGIN`. |
| Host validation | PASS | `_host_ok()` L610–620 rejeita `Host` não-loopback em GET e POST (L623–624, L634–635) → 403 `PORTAL-HOST`. Defesa DNS-rebinding: `attacker.example` resolvendo para `127.0.0.1` não alcança a API nem os assets. |
| Input validation | PASS | POST exige `Content-Type: application/json` L695–700; corpo ≤1 MiB L716–722; JSON deve parsear para `dict` L723–733; params casados por `{name}` no registry tipado; `registry_ops.py` aplica `^[a-z0-9][a-z0-9-]{0,63}$` no nome do forge (L19, L115). |
| Path traversal | PASS | `_static()` L862–889: `unquote` → normaliza `Path` → recusa `..`/absoluto → `resolve()` + `relative_to(assets)` → fallback SPA só para caminhos sem extensão; misses com extensão → `send_error(404)`. Conteúdo servido via `read_bytes` de alvo já contido. Testes: traversal e symlinks em `test_security_c5.py`. |
| Allowlist | PASS | Dispatch só via `Operation` registry tipado (`_find_op` L677–680); ops desconhecidas → 404 `PORTAL-NOT-FOUND`. Exec de subprocesso existe **apenas** em `registry_ops.py` (fora do arquivo vendável por design, L3–6): argv-array fixo `_REGISTRY_ACTIONS` L21–31, `subprocess.run` sem shell L54–60, timeout 60–300 s. `forge_portal.py` mantém o invariante "no exec primitives" (assertado por `test_security_c5.py`). |
| Rate limiting | PASS | `RateLimiter` 10 mutações/60 s L991; enforcement antes do corpo L702–711 → 429 `PORTAL-RATE-LIMITED` `retryable`. Ops read-only não consomem a janela. |
| Redaction | PASS | `redact()` L457–471 aplicada a toda resposta de op (L814), a eventos SSE (L853) e a eventos emitidos pelos adapters (L1027): chaves contendo `token|secret|password|cookie|authorization|api_key|apikey|credential` → `«redacted»`. `_REDACT_EXEMPT = {"plan_token"}` (L62) — necessário ao fluxo plan→confirm. **Ressalva:** redação é por nome de chave, não por padrão de valor (ver §Ressalvas). |
| Timeouts | PASS | `Operation.timeout` default 30 s (L176); execução via `run_with_timeout` (L782, L1003–1005) → `PORTAL-TIMEOUT` `retryable` L788–794; a thread órfã é abandonada com o end real do span registrado (L769 comment). Timeouts maiores declarados por op (registry plan 90 s, execute 320 s — `registry_ops.py` L168/L178). |
| Segredos | PASS | Nenhum segredo literal em `src/` (grep na §Frontend); tokens são por-boot (não persistidos); `_plan_secret` = `secrets.token_bytes(32)` L989; scrub cobre saídas. Variáveis de conta do instalador são validadas **sem ler segredos** (L264 comment). |
| Renderização de conteúdo não confiável | PASS | Angular sanitiza bindings por padrão; único `bypassSecurityTrustHtml` é `icon.ts` com mapa `PATHS` constante de compile-time (nenhuma string de usuário/rede alcança) — decisão registrada em `docs/audits/security-cycle6.md`. Links externos na command palette passam por allowlist de esquema `https:`/`http:`/`mailto:` (`command-palette.ts` + spec). Respostas de erro stdlib agora escapam message/explain com `html.escape` (L527–536). |
| Exportações | PASS | Export SVG do grafo escapa labels via `esc()` (`& < > "`) — `graph-page`/cytoscape-adapter; download é `Blob` client-side, nada é escrito em disco pelo portal. Nenhum caminho de export toca o filesystem do servidor. |
| Bibliotecas frontend | PASS | Runtime: Angular 22.2, RxJS, tslib, Cytoscape 3.34.3 lazy-load (`import()` dinâmico — só baixado quando o canvas é aberto). Zero scripts de terceiros no `index.html`; CSP `script-src 'self'` impede injeção posterior. |
| Dependências NPM/Python | PASS | `npm audit` 2026-10-18: **0 vulnerabilidades**. Backend: stdlib-only (zero dependências de runtime); dev-deps em `requirements-dev.txt` (pytest, ruff, playwright) não vão ao bundle vendável. |

## Frontend — greps reproduzidos nesta branch

```text
$ grep -rn "innerHTML\|bypassSecurityTrust" src/ --include="*.ts"
src/app/shared/icon.ts   [innerHTML]="svg()" + bypassSecurityTrustHtml(PATHS[name])
                         → mapa constante compile-time; ver decisão acima.

$ grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{8,}" src/
(sem ocorrências — nenhum segredo literal no bundle)

$ grep -rniE "https?://" src/ --include="*.ts" | grep -v "localhost\|127.0.0.1\|w3.org"
(sem URLs externas hardcoded — links externos vêm dos dados e passam
 pela allowlist de esquema da command palette)

$ grep -rn "Access-Control" portal_core/
(sem ocorrências — CORS deny-by-default)

$ grep -rn "subprocess\|os.system\|eval(" portal_core/forge_portal.py
(sem ocorrências — exec só existe em registry_ops.py, argv-array)
```

## Ressalvas (aceites documentados, não varridos para debaixo do tapete)

1. **Session token sem TTL** — válido pelo tempo de vida do processo.
   Mitigação real: loopback-only + SameSite=Strict + compare_digest; o
   token morre com o servidor. Risco residual: um processo local malicioso
   do próprio usuário já poderia ler o token do ambiente — modelo de
   ameaça aceito para uma ferramenta local.
2. **Redação por nome de chave** — um segredo dentro de um campo `notes`
   não é detectado. Nenhum adapter atual emite segredos em campos
   genéricos; se isso mudar, a redação por padrão de valor é a evolução
   correta, não um patch aqui.
3. **Sem cancelamento de op em flight** — `PORTAL-TIMEOUT` devolve o
   controle ao cliente, mas a thread segue até terminar (bounded pelo
   timeout do subprocesso quando há CLI).
4. **`style-src 'unsafe-inline'`** — exigido pelo Angular; mitigado por
   `script-src 'self'` estrito + `object`/`frame` fora da política
   (ausente = bloqueado por `default-src 'self'`).

## Não-verificável / fora de escopo

- **TLS** — não se aplica: o portal é loopback-only por design.
- **Segredos em logs do host** — o scrub cobre respostas da API e eventos;
  o terminal do usuário é fora do alcance do processo servidor.
- **Vendored copies** — cópias `_forge_portal.py` nos checkouts irmãos
  têm permissão de exatamente uma geração de lag
  (`tests/test_independence.py` `KNOWN_PREV_GENERATIONS`); elas recebem
  este hardening quando cada forja re-vendorar no seu próprio fluxo.
