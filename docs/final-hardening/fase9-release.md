# FASE 9 — Homologação global & release decision

Data: 2026-10-11. Estado: **READY_WITH_DOCUMENTED_LIMITATIONS**.

## 9.1 Asset parity

`scripts/vendor.py --check` — byte-parity server (`_forge_portal.py`) +
`manifest unchanged (22 files)` nos 7 destinos, executado no HEAD pós-merge:

| Destino | Server | Assets |
|---|---|---|
| the-forge / spark-aws / spark-azure / api-forge / platform / doctor-data / doctor-api | ok | ok |

## 9.2 API parity

`scripts/portal_e2e.py` — jornada real por subprocesso contra o entrypoint
de cada forja (não mocks): **7/7 PASS, 18 checks cada**:

- envelope `forge/PortalApi/1` + descriptor + capabilities não-vazia
- health + installation/status honestos (NOT_INSTALLED real, nunca inventado)
- installation/plan → plano real ou recusa nomeada
- apply com token forjado → `409 PORTAL-PLAN-STALE`
- hosts/skills/agents/tasks/mcp/graphs respondem ou recusam nomeado
- traversal → 404; op desconhecida → 404; bootstrap sem sessão → 403

## 9.3 Installation parity

Os 7 adapters usam o mesmo `default_operations` + installkit compartilhado —
plan/apply/status/repair seguem `forge/InstallReceipt|Status` com a mesma
semântica (prova: 18 checks idênticos passam nas 7).

## 9.4 UI parity

Um único bundle Angular é vendored para as 7 forjas — navegação, componentes,
estados, layout, temas e traduções são literalmente os mesmos. Verificado
por byte-parity do manifest e pelos screenshots E2E.

## 9.5 Agentic parity

Task Center legível em todas as forjas (mesmo bundle). O journey
intent → plano → confirmação → recibo passa por `tasks/plan` +
`tasks/execute` com `plan_token` validado — verificado no E2E de browser
(adapter real com ops de domínio) e no HTTP e2e (task plan intent → 200).

## 9.6 Real browser test

`e2e/test_browser_e2e.py` — Chromium real × `PortalServer` real × bundle real:
10/10 — first paint, 9 rotas, pt/en, plan→apply, Ctrl+K, task plan card,
mobile 390px, offline degradation, zero pageerror, guarda de stylesheet.

**Prova em forja real** (não adapter de teste): `spark-forge-aws`
portal real (`python -m sparkforge_aws.portal_adapter`) aberto em
Chromium — `getComputedStyle(.shell) === "grid"`, screenshots
`real-spark-aws-*.png` mostram sidebar estilizada, hero com `Spark Forge
AWS v0.5.0`, capabilities reais (7/8, graph `unverified` honesto),
`mcp-handshake: 146 tools`, `Não instalado` honesto.

## 9.7 Security review (adversarial executado)

| Vetor | Defesa | Evidência |
|---|---|---|
| Sem sessão | 403 `PORTAL-SESSION` | teste + e2e 7/7 |
| Cross-origin POST | 403 `PORTAL-ORIGIN` | teste + e2e |
| DNS rebinding (Host) | 403 `PORTAL-HOST` — novo | 4 testes novos |
| Content-Type errado | 415 `PORTAL-CONTENT-TYPE` | teste (agora chega ao cliente) |
| Rate limit | 429 `PORTAL-RATE-LIMITED` | teste |
| Payload >1 MiB | 413 | teste |
| Plan token forjado | 409 `PORTAL-PLAN-STALE` | e2e 7/7 |
| Path traversal | 404 | e2e 7/7 |
| Recusa cega (socket RST) | `_reject()` drena body | teste + causa-raiz documentada |
| CSP vs bundle | `inlineCritical: false` | `test_global_stylesheet_applies` |
| Secrets | denylist `redact()` + sem secrets no código | revisão manual |
| Loopback bind | `PortalServer` recusa host não-loopback | `ValueError` no construtor |

## 9.8 Accessibility

Skip-link, `aria-current` na nav, `sr-only` nos headers de tabela,
badges com texto (não só cor), foco visível — presentes no bundle.
Auditoria formal WCAG 2.2 AA (axe): **não executada** — limitação
documentada (ver §decisão).

## 9.9 Usability acceptance

Jornada "novo usuário": abrir portal → dashboard explica o estado →
Primeiros passos orientados → hosts/MCP → intent em linguagem natural →
plano legível → executar → resultado estruturado — **demonstrada** no
E2E (E2EAdapter real) e visualmente no spark-aws real.

## 9.10 Documentation acceptance

Receitas de portal existem por forja (PT-BR) e foram atualizadas com as
novas recusas. Guias completos por domínio (Glue/Iceberg/OpenAPI/etc.)
existem parcialmente nos `docs/learn/recipes/` de cada forja — cobertura
integral dos tutoriais pedidos pelo programa: **parcial** — limitação.

## 9.11 CI acceptance

`.github/workflows/ci.yml` adicionado ao forge-portal (ruff, pytest,
prettier, ng build strict, vitest, i18n, playwright E2E + artifacts,
vendor parity, portal_e2e cross-forge). **CI online não rodou** — conta
GitHub sem cota; todos os gates foram executados localmente com saída
capturada neste documento e em `baseline.md`/`fase1-portal-core.md`.

## 9.12 Release decision

**READY_WITH_DOCUMENTED_LIMITATIONS**

Pronto para uso: shell estilizado (bug crítico corrigido), segurança
adversarial coberta por testes, jornada install/task legível e real nas
7 forjas, i18n integral, CI entregue.

Limitações registradas (não bloqueantes, sem falsidade):
1. Telas especializadas por domínio (PySpark/Glue/OpenAPI/Terraform…)
   ainda não existem como páginas dedicadas — o portal expõe o que cada
   adapter declara; especialização vem dos descriptors/ops por forja.
2. Firefox/WebKit no E2E — só Chromium validado.
3. Auditoria axe/WCAG formal pendente.
4. Execução via hosts de IA reais (Devin/Claude/Codex) depende de
   credenciais do usuário — detectado e exibido honestamente, não
   executado no E2E.
5. Tutoriais PT-BR por domínio existem parcialmente — ampliar por forja.
6. CI verde online pendente de cota do GitHub — gates locais todos verdes.

## PRs desta homologação

| Repo | PR |
|---|---|
| forge-portal | #5 — Task Center, E2E, Host guard, CSP/beasties fix |
| the-forge | #48 |
| spark-forge-aws | #153 |
| spark-forge-azure | #45 |
| api-forge | #57 |
| platform-forge | #26 |
| forge-doctor-data | #30 |
| forge-doctor-api | #34 |
