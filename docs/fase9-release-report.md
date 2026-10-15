# Forge Portal — relatório de release (FASES 0–9)

Data: 2026-10-11. Escopo: `prompt_evo_portal.md` — UI web local opcional
sobre os serviços reais de cada forja, vendored byte-parity, seguro por
construção.

## Arquitetura entregue

- `portal_core/forge_portal.py` — servidor stdlib-only canônico
  (loopback + token de sessão 128-bit, `X-Forge-Session`, Origin
  loopback em POST, `confirm` literal, `plan_token` assinado HMAC,
  `PORTAL-PLAN-STALE`, rate limit, payload cap, SSE, redação de
  segredos, traversal bloqueado).
- `scripts/vendor.py` — propaga servidor + assets com manifest sha256;
  `--check` prova byte-parity nos 7 destinos.
- SPA Angular (signals, lazy routes, runtime i18n pt-BR/en, 7 temas,
  tokens CSS) — 293 kB raw / 81 kB transfer, sem CDN.
- Adapter por forja: `plan→confirm→apply` delega aos serviços reais;
  estados honestos (`NOT_INSTALLED`, `DEGRADED`, `NOT_APPLICABLE`,
  recusas nomeadas `*-PORTAL-*`/`FORGE-*`).

## Commits por repositório (branch `feat/forge-portal`)

| Repo              | Commits principais                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| forge-portal      | `9d43dd4` fase0 · `52512d8` fase1 · `56ca995` fase2 · `2d393de` fase3 frontend · `d250486` vendor overrides · `558937b` fase8 · `1b4e6c9` e2e |
| spark-forge-aws   | `a4308b44` portal + verbo + SDD · `1ea0a57f` doc_manifest · `51aa521b` assets f8 · `0b311b5b` flush                                           |
| api-forge         | `d8297fa` portal + analyze real + SDD · `ef384e4` doc_manifest · `4ec5fb6` assets f8 · `b751b39` flush                                        |
| spark-forge-azure | `66c4f80` portal + SDD · `398cc87` doc_manifest+claims · `d0b7d5d` assets f8 · `d10286f` flush                                                |
| platform-forge    | `e2ea6f6` portal · `fda0cc5` doc_manifest · `c68110a` assets f8 · `a6eb8dc` flush                                                             |
| forge-doctor-data | `78d2017` portal (poetry portal_assets) · `ed7a597` doc_manifest+parity · `517e101` assets f8 · `98caba8` flush                               |
| forge-doctor-api  | `a47e416` portal checkout-level (scripts/, boundary/RC-safe) · `cb4799d` doc_manifest · `dc830ec` assets f8                                   |
| the-forge         | `4abc7aa` command center + ADR 0059 · `79543ef` assets f8                                                                                     |

## Evidência de verificação

- **Suítes de portal por repo**: the-forge 20/20 · spark-aws 17/17 ·
  azure 18/18 · api-forge 20/20 · platform 18/18 · doctor-data 18/18 ·
  doctor-api 15/15 · portal_core 29/29 · Angular 11/11.
- **E2E global** (`scripts/portal_e2e.py`): 7/7 forjas, 18 checks cada —
  subprocesso real do verbo, 403 sem sessão, envelope `forge/PortalApi/1`,
  estados honestos, `PORTAL-PLAN-STALE` em token forjado, traversal e
  op desconhecida 404, task plan. 126 assertions verdes.
- O harness de startup agora é bounded: drena logs precedentes, encontra a
  linha JSON de contrato e falha em até 30s quando a URL não chega; dois testes
  cobrem logs antes da URL e processo sem contrato. Execução real pós-correção:
  7/7 forjas PASS.
- **i18n gate** (`scripts/check_i18n.py`): 240/240 chaves pt-BR/en,
  112 chaves estáticas cobertas, zero prosa hardcoded, estados de
  contrato do badge cobertos.
- **Gates por repo**: ruff verde nos arquivos novos; SDD `ok` onde o
  processo exige (aws/azure/api); surface locks regenerados; rc-baseline
  do doctor-api regenerado (88 test files); mypy sem delta novo.
- **Wheels**: assets embutidos via force-include/package-dir em todos
  (verificado: the-forge 25 arquivos `theforge/portal_assets/*`).

## Correções de raiz capturadas pela fase

1. `doc_manifest.py` inventariava `.pytest_tmp-<n>` (basetemp numerado)
   — exclusão por prefixo nos 7 repos.
2. `print(url)` sem `flush` travava consumidores pipe — fix nos 5
   adapters + the-forge + doctor-api.
3. `description_key` de perfil renderizava a chave crua — agora passa
   pelo pipe `| t`.
4. Uninstall executava num clique — confirmação armada (8s) com
   `role=alert`, mesma ética plan→confirm→apply.
5. `install_auto` com registry vazio lançava `InstallError` — agora
   recusa nomeada `TF-PORTAL-NOT-REGISTERED`.

## Limitações declaradas

- Loopback only; sem TLS (token de sessão é a fronteira, por desenho).
- `install_auto` delega CLIs reais com timeout longo — forja sem CLI
  resolvível vira `BLOCKED` nomeado, nunca falso PASS.
- Probes de checkout cobrem o workspace; forjas fora da árvore aparecem
  pelo registry `~/.forge/installations`, não por `checkout`.
- Formatação `ruff format` repo-wide tem baseline pré-existente não
  relacionada; arquivos novos seguem o padrão.
