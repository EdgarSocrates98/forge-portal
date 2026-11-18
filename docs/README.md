# Documentação do Forge Portal — índice

Portal = **host de UI vendored** do ecossistema Forge, não uma Forja
(provider do Forge Protocol). O servidor canônico
(`portal_core/forge_portal.py`) e o bundle Angular são propagados
verbatim para as Forjas irmãs por `scripts/vendor.py`; cada Forja serve o
portal via `<cli> portal`. Detalhes operacionais para agentes:
`../AGENTS.md`.

## Fundamentos (Fase 0)

- `fase0/architecture.md` — arquitetura do portal (SPA + servidor loopback).
- `fase0/contracts.md` — `forge/PortalApi/1`, envelope, códigos de erro.
- `fase0/security-matrix.md` — modelo de segurança (sessão, CSRF,
  plan_token, redação).
- `fase0/capability-map.md` — mapa de capacidades por Forja.
- `fase0/distribution-plan.md` — plano de distribuição/vendoring.

## Operação

- `installation/README.md` — contrato de instalação
  (plan → review → confirm → execute → receipt), distinção
  `forge/node-install/v1` × `forge/InstallReceipt/v1`, precedência de
  `--root`, delegações conhecidas.
- `installation/federation-onboarding.md` — onboarding federado.
- `account-environment.md` — variáveis de conta `*_HOME`/`*_VENV`…
- `homologation/README.md` — matriz de homologação real + gaps abertos
  (telemetria `UNSUPPORTED` nos adapters é o gap #1 documentado).
- `testing/README.md` — guia de testes.
- `release/README.md` — pipeline de release/dumps e matriz de versões.
- `../docs/troubleshooting.md` — resolução de problemas comuns.

## Segurança e observabilidade

- `security/` — revisões de segurança por ciclo.
- `observability/execution-events.md` — contrato `forge/PortalEvent/1`.
- `integrations/code-atlas.md` — integração Code Atlas (probe read-only).

## UX, grafo e performance

- `design/`, `ux/`, `architecture/graph-studio-2.1.md` — UX e Graph Studio.
- `graph/` — paridade e decisões do renderer.
- `perf/` — baselines e relatórios de performance.

## Auditorias e histórico

- `audits/` — baselines e revisões de cada ciclo.
- `reports/`, `roadmap/`, `final-hardening/`, `fase1/`, `fase2/`,
  `fase9-release-report.md` — relatórios de fase e fechamento.
- `codebase/` — análise estática do repo (arch/stack/structure/
  conventions/testing/integrations).
- `engineering-excellence/` — readiness de UX.
- `knowledge/` — avaliações do assistente/busca.
