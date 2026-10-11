# FASE 0 — Baseline reproduzível

Data: 2026-10-11. Programa: `prompt_evo_portal_ultimate.md` (Forge Portal
Ultimate Hardening & Premium Experience 2.0). Regra: nada do relatório
histórico é assumido — cada item foi reexecutado no HEAD atual.

## Estado dos repositórios (main, HEAD)

| Repo | HEAD | Working tree | Portal suite | Resultado |
|---|---|---|---|---|
| forge-portal | `6b74373` | clean | `tests/test_forge_portal.py` | **1 failed / 36 pass** → corrigido nesta fase |
| the-forge | `e479ebb` | clean | `tests/test_portal.py` | 20/20 pass |
| api-forge | `19af787` | clean | `tests/test_portal_adapter.py` | 20/20 pass |
| spark-forge-aws | `0e48cbc5` | clean | `tests/test_portal_adapter.py` | 17/17 pass |
| spark-forge-azure | `7c57843` | clean | `tests/test_portal_adapter.py` | 18/18 pass |
| platform-forge | `c5b3f1d` | clean | `tests/test_portal_adapter.py` | 18/18 pass |
| forge-doctor-data | `8158f32` | clean | `tests/test_portal_adapter.py` | 18/18 pass |
| forge-doctor-api | `9aaa331` | clean | `tests/test_forge_portal.py` | 15/15 pass |

Asset parity: `scripts/vendor.py --check` — **server byte-parity ok +
manifest unchanged (22 files) nos 7 destinos.**

## Falha real reproduzida e corrigida

`test_post_wrong_content_type_415` / `test_post_cross_origin_403` —
**ConnectionAbortedError WinError 10053**. Causa-raiz: o handler
rejeitava POSTs (sessão inválida, Origin cross-site, Content-Type errado,
rate limit, payload >1 MiB) **sem drenar o request body**. O socket
fechava com dados não lidos → kernel envia RST → o cliente nunca recebe
a resposta. O caminho 413 já drenava; os demais não.

Fix: `_reject(status, payload)` — drena o body (até 8 MiB) antes de
responder e fecha com `Connection: close`. Aplicado a 404-non-API,
403-session, 403-origin, 415-ctype, 429-rate-limit, 413-oversize.
Suite: **37/37 determinístico**.

## CI dos especialistas (achados históricos GAP-001)

O CI do GitHub está sem cota no momento — falhas históricas reavaliadas
contra o HEAD local com os gates por repo:

- the-forge: portal suite 20/20; ruff `check .` limpo (último gate local).
- api-forge: portal 20/20; install e2e 18/18; ruff limpo.
- spark-forge-aws: portal 17/17; `test_install.py` 30/30; ruff limpo.
- spark-forge-azure: portal 18/18; install lifecycle 17/17;
  surface lock ok. **Gate preexistente**: `check_portability.py` falha
  em `_forge_portal.py:234` (path audit `Path.home()`) e `current_state`
  stale — avaliar se é falso-positivo do vendored ou bug real.
- platform-forge: portal 18/18; install+tui+workspace verde; ruff limpo.
- forge-doctor-data: portal 18/18; install lifecycle 23/23; ruff limpo.
- forge-doctor-api: portal 15/15; install+boundary 28/28; ruff limpo.

## Ferramentas disponíveis (descoberta §3 do prompt)

- Playwright 1.64.0 (Python, `C:\Python314\Scripts\playwright.exe`) +
  Chromium lançável — **E2E de browser real é viável** (GAP-002).
- `scripts/portal_e2e.py` — HTTP e2e existente (7/7 forjas, 18 checks).
- `scripts/check_i18n.py` — gate i18n 259/259 chaves.
- Angular 22 / TS 6 / Vitest — signals, lazy routes, strict.
- MCP servers: codebase-memory graph (para descoberta de código).

## Bloqueios externos registrados

- GitHub Actions sem cota — gates rodam localmente; CI file ainda será
  entregue mas não verde online.
- Hosts de IA (Devin/Claude/Codex) — detecção via adapters é real;
  execução de tarefa via host depende de credenciais do usuário
  (registrar BLOCKED quando não demonstrável).

## Critérios de aceite do programa

1. Portal abre em browser real (Chromium) em todas as páginas.
2. `install`/`status`/`doctor`/`repair`/`update`/`uninstall`/`mcp-verify`
   executáveis pela UI com recibo real.
3. Task Center mostra plano legível (não JSON cru por default).
4. i18n pt-BR/EN integral, zero chave faltante.
5. Recusas HTTP chegam ao cliente em todas as condições (corrigido).
6. Byte-parity server+assets nos 7 destinos após re-vendor.
7. Manual de portal por forja (PT-BR+EN).
8. Evidências por fase em `docs/final-hardening/`.
