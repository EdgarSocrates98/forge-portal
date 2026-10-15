---
id: cyc9-10
title: portal-forge-lab-section
status: done
created: 2026-10-15
owner: forge-portal
scope: repo
cycle: 9
wave: 3
priority: p1
risk: medium
agent: codex
source: prompt_evo_cycles.md §9.9
verification: []
---

# Forge Lab no Portal

## Outcome

Seção Forge Lab no Portal: catálogo de cenários, filtros por Forja, histórico de execuções, comparação entre versões, gráficos de tempo/tokens/custos/qualidade/taxa de sucesso, findings, evidências, exportação JSON/Markdown e comparação baseline vs Forge-enabled — sempre sobre dados reais.

## Grill gate

- Problema observado: resultados de benchmark (quando existirem) não têm superfície visual.
- Usuário afetado: usuário avaliando ganhos do ecossistema; revisor de claims públicos.
- Falha concreta: sem UI honesta, tentação de publicar número sem evidência navegável.
- Decisão: seção consumindo o backend/contratos do lab (cyc9-01/02); "Sem dados" quando não houver medição.
- Fora de escopo: inventar benchmarks; duplicar lógica de avaliação no frontend; executar lab pela UI sem backend real.
- Critério de parada: todos os elementos do §9.9 renderizados de dados reais, com exportação e estado vazio honesto.

## Acceptance

- Catálogo de cenários + filtro por Forja + histórico + comparação entre versões.
- Gráficos: tempo, tokens, custos, qualidade, taxa de sucesso; findings e evidências navegáveis.
- Exportação JSON e Markdown por execução/comparação.
- Comparação baseline vs Forge-enabled.
- Estado vazio = "Sem dados" explícito; backend indisponível = estado indisponível, nunca mock.

## Constraints

- Dados só de serviços/contratos reais (receipts/runs do lab).

## Verificação

- Confirmar no dispatch: `npm run build` / `npm test` / lint do repo.

## Pending

- ⚠ Depende de cyc9-01 (coordenador produzir runs consumíveis) — contrato de leitura a definir.
