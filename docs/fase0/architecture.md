# Forge Portal — Arquitetura (FASE 0)

> Status: **baseline aprovada para implementação** (FASE 0 gate).
> Decisões numeradas ADR-style. Onde o prompt pede avaliação, a decisão
> registra as alternativas e o motivo.

## ADR-001 Repositório e distribuição

**Decisão:** novo repositório irmão `forge-portal` contendo o workspace
Angular (fonte única), o servidor Python canônico (`forge_portal.py`) e o
pipeline de vendoring que copia **assets buildados + módulo vendored**
para cada Forja.

- Cada Forja distribui de forma independente: `portal/assets/` (bundle
  Angular compilado, commitado como artefato de release) +
  `src/<pkg>/_forge_portal.py` (vendored byte-parity) +
  `src/<pkg>/portal_adapter.py` (próprio, não vendored) +
  verbo `<cli> portal`.
- Um único bundle Angular serve as 7 experiências — tema e superfície
  vêm do `PortalDescriptor` em runtime, não de builds por-Forja.
  Alternativa rejeitada: 7 bundles por Forja (7× build, drift de
  versão, sem ganho — a superfície já é capability-driven).
- Vendoring segue o padrão do ecossistema (`_installkit.py`,
  `_graphstudio.py`, `i18n.py`): regra byte-parity + manifest sha256.

## ADR-002 Backend: stdlib-only, não FastAPI

Avaliado: FastAPI, Starlette, `http.server` stdlib.

**Decisão:** `ThreadingHTTPServer` stdlib — mesmo padrão de
`_graphstudio.py` (já serve uma UI local real hoje).

Motivos:

- 3 dos 7 repos proíbem deps de runtime além do conjunto mínimo
  (the-forge é stdlib-only; doctors congelam deps via `sbom.py`/
  `rc-discipline`). FastAPI forçaria exceção de dependência em todos.
- A API é tipada via contratos versionados + validação explícita —
  não precisa de OpenAPI runtime para 15 endpoints.
- SSE para progresso de task funciona em `http.server` chunked.

## ADR-003 Frontend: Angular 22 + signals + i18n em runtime

- Angular **22.x** (estável atual), TS strict, standalone, lazy
  routes, signals, sem zone (zoneless por padrão no scaffold novo).
- Estrutura: app única `src/app/` com features espelhando a taxonomia
  do prompt (`core/`, `shared/`≈design-system, `features/{dashboard,
install,profiles,hosts,mcp,skills,agents,tasks,graph,knowledge,
settings}`). Não cria libs Nx separadas — um bundle pequeno e sem
  overhead de multi-projeto é a escolha econômica (prompt permite).
- **i18n runtime**: dicionários JSON `assets/i18n/{pt-BR,en}.json` +
  `I18nService` por signals. `@angular/localize` compila por locale
  (exigiria 2 builds + reload p/ trocar) — requisito é troca imediata
  na mesma instalação → runtime dictionary é a resposta correta.
- Sem Tailwind: design tokens CSS semânticos + componentes próprios
  (identidade Forge própria, bundle mínimo, zero framework visual
  concorrente). Angular CDK somente se algum primitive de a11y se
  mostrar necessário — deferido.
- HTTP: `provideHttpClient(withInterceptors)` + interceptor de sessão.

## ADR-004 Graph: reutilizar o Studio existente, não Cytoscape/Sigma

Avaliado: Cytoscape.js, Sigma.js, reuso do `_graphstudio` existente.

**Decisão:** a página Graph do portal serve o documento Forge Graph
Studio real (gerado pelo `_graphstudio.py` vendored de cada Forja) em
`<iframe sandbox>` + painel inspetor Angular alimentado pelo mesmo
`ForgeGraphView/v1` via `/api/graphs`.

Motivos: renderer real já testado em 7 repos; zero dep nova (~1MB de
Cytoscape evitado); "não recriar Graphfy" honrado; busca/filtro/
inspector/export cobertos pelo documento + trilhos Angular.

## ADR-005 Segurança local

- Bind **somente `127.0.0.1`**; sem opt-out via CLI na v1.
- **Sessão**: token aleatório de 128 bits na URL de abertura
  (`?forge_session=…`); o bootstrap da SPA troca por cookie
  `SameSite=Strict` + header `X-Forge-Session` (double-submit).
- Mutações: POST apenas, `Content-Type: application/json`, header de
  sessão obrigatório, `Origin`/`Host` allowlist (loopback), registry
  de operações tipadas — **nenhum shell arbitrário**.
- Aprovação humana: `plan → review → confirm → execute → verify →
receipt` — o mesmo pipeline do install service (não reimplementado).
- Sem segredos nas respostas; redação via allowlist de campos.
- Path serving: somente `assets/` hash-manifest; fora → 404.
- Rate limit simples por sessão nos POSTs mutáveis.

## ADR-006 Contrato PortalContract/v1

Envelope único versionado (`forge/PortalApi/1`), endpoints sob
`/api/v1/`. Modelos mapeiam os do prompt §5 para o que os serviços
reais produzem (ver `contracts.md`). Erros seguem
`{code,message,details,severity,retryable,action,correlation_id}` —
`code` estável + `message_key` para i18n no cliente.

## ADR-007 Operações = mesmo serviço, mesmo receipt

O adapter chama os serviços internos da Forja (install.service,
hostflow, mcp verify, catalog loaders, graphview, docs inventory) no
mesmo interpretador — o servidor roda dentro do venv da Forja.
Receipts devolvidos são os objetos reais dos serviços (instalação
feita pelo portal aparece em `<cli> install status` e vice-versa).

## ADR-008 The Forge = Command Center

`the-forge`'s adapter adiciona: descoberta de checkouts irmãos
(`specialists.collect`), capabilities federadas, roster/ask/task e o
catálogo federado. O mesmo `_forge_portal.py` serve — só o descriptor
e o registry de ops crescem.

## Estrutura de diretórios

```text
forge-portal/
├── src/                  # app Angular (features + core + shared)
├── portal_core/
│   └── forge_portal.py   # servidor vendored canônico
├── scripts/
│   └── vendor.py         # propaga _forge_portal.py + assets
├── e2e/                  # playwright (quando browsers disponíveis)
├── docs/                 # arquitetura, contratos, runbooks
└── tests/                # pytest do módulo vendored
```

```text
<forge-repo>/
├── portal/assets/        # bundle Angular vendored + manifest sha256
└── src/<pkg>/
    ├── _forge_portal.py  # vendored (byte-parity)
    └── portal_adapter.py # adapter próprio da Forja
```

## Riscos registrados

- Bundle vendored ×7 ~ duplicação de artefato de release — aceito
  pela exigência de distribuição independente; mitigado por bundle
  enxuto (meta < 600 KB brotli inicial).
- Playwright browsers podem não baixar → E2E via browser real da
  sessão + smoke de servidor; UNVERIFIED declarado se faltar.
- Perfis Economy/Balanced/Full mapeiam para a seleção real de
  componentes do install service — validado por Forja na integração.
