# Troubleshooting — Forge Portal

Problemas comuns do portal, do CLI e do vendoring. O portal reporta
estados honestos — um `unavailable`/`unverified`/`BLOCKED` é uma resposta
real, não um bug a mascarar.

## O portal não sobe

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| `forge-portal start` → "Portal build not found" | `dist/` não existe | `npm run build` no checkout |
| `ng serve` não inicia | `node_modules` incompleto | `npm install` |
| `<cli> portal` recusa | Forja sem adapter portal | a Forja precisa montar `_forge_portal.py` vendored |
| Browser abre mas 403 em tudo | token de sessão ausente | a sessão é exigida em mutações e leituras autenticadas; recarregue a página pelo URL com token emitido pelo servidor |

## `python scripts/vendor.py --check` falha

- **`DRIFT <repo>: N target(s) out of parity`** — a cópia vendored
  (`_forge_portal.py`, `_portal_telemetry.py`, `_portal_atlas.py` ou
  `portal/assets` + manifest) diverge do canônico. Corrija rodando
  `python scripts/vendor.py` (ou `vendor.py --repo <nome>`) num workspace
  com os checkouts irmãos presentes — a propagação escreve nos repos de
  destino.
- **`SKIP <repo>: checkout not found`** — o irmão não está clonado ao
  lado; o resumo `checked N of M` distingue isso de um PASS real. Para
  exigir todos os destinos presentes use `--check --require-all`
  (saída 3 quando falta checkout).
- **Atlas ausente num irmão** — desde a wave 15 atlas é opt-in por
  destino (`modules` no FORGES do vendor.py). Se o adapter do irmão
  passar a montar `atlas_operations()`, adicione `"atlas"` em `modules`
  e re-vendor.

## Recursos/membros não aparecem em `/resources`

- O endpoint lista apenas membros com marcador na raiz da workspace
  (`--root` do servidor): `.git`, `forge.json`, `forge.agentic.json`,
  `pyproject.toml` ou `package.json`, até 2 níveis de profundidade.
  Dirs ocultos, `node_modules`, `.venv`, `dist`, `__pycache__` e afins
  são ignorados; symlinks nunca são seguidos.
- Catálogo de recursos vem só de `forge.agentic.json` — um membro sem
  manifest aparece em `members` mas não contribui recursos (estado
  honesto, não erro).
- Campos `version`/`domain`/`hosts`/`hash`/`integrity` só aparecem
  quando declarados pelo manifest — `null` significa "não declarado".

## Telemetria / Context Observatory vazio

`forge/PortalEvent/1` é opt-in por adapter: hoje **nenhum adapter
vendored registra ops `/events`** (gap de homologação #1, documentado em
`docs/homologation/README.md`). Context accounting por recurso
(tokens/bytes por recurso carregado) é **UNSUPPORTED em todos os
adapters** — é delegação declarada, não implementação pendente no
portal. Não trate como defeito do frontend.

## `FORGE_CLI_BIN`

`portal_core/registry_ops.py` honra `FORGE_CLI_BIN` como override do
binário forge-cli — é configuração de operador. Um valor apontando para
binário malicioso executa com as credenciais do usuário: trate a
variável como parte da fronteira de confiança (ver `SECURITY.md`).

## Erros recusados esperados

`PORTAL-SESSION`, `PORTAL-ORIGIN`, `PORTAL-CONFIRM`, `PORTAL-PLAN-*`,
`PORTAL-RATE-LIMIT`, `PORTAL-NOT-FOUND` são recusas nomeadas do modelo
de segurança — repetir a mesma mutação exige novo `plan_token`
(one-time, anti-replay). Um `PORTAL-PLAN-STALE` após editar o plano é
comportamento correto.
