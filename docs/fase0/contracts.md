# Forge Portal — PortalContract/v1 (FASE 0)

Todos os payloads trafegam como JSON UTF-8 sob `/api/v1/`. Envelope:

```jsonc
{
  "schema": "forge/PortalApi/1", // sempre presente
  "correlation_id": "tok12", // eco do X-Correlation-Id ou gerado
  "data": {/* payload do endpoint */},
}
```

Erro estruturado (§20 do programa):

```jsonc
{
  "schema": "forge/PortalApi/1",
  "correlation_id": "tok12",
  "error": {
    "code": "PORTAL-INSTALL-LOCKED", // estável, nunca traduzido
    "message": "texto operador en", // mensagem real do serviço (en)
    "message_key": "error.install.locked", // chave i18n do cliente
    "details": { "field": "scope" },
    "severity": "error", // info|warning|error
    "retryable": false,
    "action": "unlock_hint", // sugestão curta, en
  },
}
```

## Modelos (o que cada serviço real produz)

| Modelo                           | Origem real                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PortalDescriptor`               | `forge.json` + adapter: id, nome, versão, cli, tema, capabilities[], nav[]                                                        |
| `PortalCapability`               | `forge.agentic.json` provides + flags medidos (graph, mcp, agents, skills, install, tasks, docs)                                  |
| `PortalHealth`                   | `install.service.status()` + doctor — `state` ∈ NOT_INSTALLED\|INSTALLED\|CONFIGURED\|ACTIVE\|VERIFIED\|DEGRADED\|BLOCKED\|FAILED |
| `InstallationPlan/Receipt`       | `install.service` plan/apply receipts (mesmos bytes do CLI)                                                                       |
| `ProfileDescriptor`              | componentes do install (`components` map) + preset economy/balanced/full                                                          |
| `HostDetection/Integration`      | `hostflow.observe()` receipts — detection, version, logged_in, integration, launchable                                            |
| `MCPServerDescriptor/Handshake`  | `install mcp-verify` equivalente in-process                                                                                       |
| `SkillDescriptor`                | `skills_catalog`/`expected_skill_mirrors` — discovered\|installed\|available\|unverified                                          |
| `AgentDescriptor`                | roster canônico + mirrors esperados — authority, access, domains                                                                  |
| `TaskRequest/Execution/Evidence` | execução de verbo seguro da Forja (scan/analyze/ask) — stage, exit_code, receipt                                                  |
| `GraphDescriptor`                | `graphview.build_view()` → ForgeGraphView/v1 + availability                                                                       |
| `DocHit`                         | `docs/knowledge-program/inventory.jsonl` + title/excerpt local                                                                    |
| `FederationSnapshot/Plan`        | catálogo de especialistas, registry local e `install_auto` com decisões propagadas                                                |

## Endpoints

```text
GET  /api/v1/bootstrap        descriptor + health + session rotate (único GET autorizado p/ o bootstrap)
GET  /api/v1/health           PortalHealth
GET  /api/v1/capabilities     PortalCapability[]
GET  /api/v1/installation/status
POST /api/v1/installation/plan     {scope?, components?} → plan receipt
POST /api/v1/installation/apply    {plan_token, confirm:"apply"} → receipt stream SSE
POST /api/v1/installation/repair
POST /api/v1/installation/uninstall {confirm:"uninstall"}
GET  /api/v1/profiles         profiles + atual + diffs
POST /api/v1/profiles/apply   {profile, confirm} → receipt
GET  /api/v1/federation       catálogo, registry e estado observado dos especialistas
POST /api/v1/federation/plan  {scope, host, profile, gateway_profile, components?, forge?} → plano federado
POST /api/v1/federation/install-auto {plan_token, confirm:"install"} → recibo por Forja
GET  /api/v1/hosts            HostDetection[] observe-only
POST /api/v1/hosts/launch     {host} → recusa se !tty/!login — portal nunca lança sem TTY real? ver nota
GET  /api/v1/mcp/servers
POST /api/v1/mcp/verify       handshake real, invoke seguro
GET  /api/v1/skills           SkillDescriptor[]
GET  /api/v1/agents           AgentDescriptor[]
GET  /api/v1/tasks            execuções recentes (session store)
POST /api/v1/tasks/plan       {intent|verb,args} → plano sem execução
POST /api/v1/tasks/execute    {plan_token, confirm} → SSE events + receipt
GET  /api/v1/graphs           {views:[ForgeGraphView], availability}
GET  /api/v1/docs/search?q=   DocHit[] busca local no inventário
GET  /api/v1/i18n/<locale>    dicionário (opcional — também embarca no bundle)
```

Regras:

- GET nunca muta. POST mutável exige `confirm` literal + `plan_token`
  quando aplicável — o token é o hash do plano revisado.
- `hosts/launch` no portal: **oferece comando preparado para copiar**
  por padrão (browser ≠ TTY); launch real só via o caminho documentado
  do host — nunca fingido.
- Campos `unverified`/`unknown`/`absent` distinguíveis sempre.

## Estabilidade

`schema` versionado; campos novos só aditivos; frontend ignora
desconhecidos. Remoção/renomeação = `PortalApi/2` + adapter dual.
