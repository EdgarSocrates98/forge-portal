---
id: cyc8-06
title: portal-release-management-ui
status: done
created: 2026-10-15
owner: forge-portal
scope: repo
cycle: 8
wave: 1
priority: p0
risk: medium
agent: codex
source: prompt_evo_cycles.md §8.6
verification: []
---

# Forge Portal — Release Management

## Outcome

Interface de release management exibindo versão instalada/disponível, canal, compatibilidade, integridade, histórico, pendências, planos de upgrade, status, receipts e rollback — todo estado vindo de serviços e contratos reais.

## Grill gate

- Problema observado: Portal não expõe estado de releases do ecossistema instalado.
- Usuário afetado: usuário que gerencia o ecossistema visualmente.
- Falha concreta: usuário não sabe se a combinação instalada é compatível nem se update é seguro.
- Decisão: UI consumindo contratos/serviços do CLI+The Forge (receipts, manifesto), sem reimplementar lógica de update.
- Fora de escopo: executar atualização pela UI com lógica própria; inventar estado quando backend não responde.
- Critério de parada: todos os campos do §8.6 renderizados a partir de contratos reais; indisponibilidade de backend visível como tal.

## Acceptance

- Campos §8.6 presentes: versão instalada, disponível, canal, compatibilidade, integridade, histórico, pendências, planos de upgrade, status, receipts, rollback disponível.
- Estado indisponível → UI mostra "indisponível/sem dados", nunca valor fabricado.
- Ações de update disparam operação do CLI/backend, com status real e receipt.
- Testes da UI contra contratos (mock só no teste, nunca em runtime).

## Constraints

- Sem segunda lógica de atualização no frontend.
- Seguir stack existente do Portal (verificar na baseline).

## Verificação

- Confirmar no dispatch: `npm run build` / `npm test` / lint do repo (a definir no grill).

## Rejected

- Estado fabricado no cliente.
- Bypass do CLI/backend para operar atualizações.

## Pending

- ⚠ Quais endpoints/contratos o backend já expõe (portal_api) — depende de cyc8-01 e cyc8-05.
