# cyc9-10 — Portal Forge Lab UI

## O que foi entregue

- `GET /api/v1/lab` no `portal_adapter.py` (the-forge): lê receipts reais
  `results-*.jsonl` + relatórios `*.md` de `docs/programs/ecosystem-2026/benchmarks/`.
  Linhas malformadas viram `notes`; nada é sintetizado.
- `LabData`/`LabRun`/`LabForgeRow`/`LabScenarioResult`/`LabMetric` em `api.models.ts`;
  `PortalApi.lab()` tipado.
- `LabPage` (`/lab`): histórico de runs, catálogo de cenários com filtro por forja,
  comparação de vereditos entre runs, métricas por cenário (medidas vs `not_available`
  renderizadas `—`), relatórios, notas do coletor, exportação JSON (run) e Markdown
  (relatório/comparação). Nav + search registrados.
- Estados honestos: `runs: []` → empty state explícito; 404/PORTAL-NOT-FOUND →
  painel UNVERIFIED; métrica não-medida → `—`, nunca número inventado.

## Verificação

- `npx tsc --noEmit` limpo
- `npm test`: 235/235 verdes (inclui 8 casos novos de LabPage + app.spec nav=18)
- `npm run build`: OK (warning pré-existente de budget em install.page)
- `vendor.py --check`: paridade nos 7 repos após re-vendor

## Limites honestos

- Comparação é de vereditos por cenário entre dois runs (dados disponíveis);
  comparação baseline vs Forge-enabled por métricas fica para quando o backend
  expuser a série `subject`/`judge` de cyc9-02 no endpoint.
- UI não executa labs — só lê artifacts já coletados.
