# Forge Portal

Portal web local e opcional para o ecossistema The Forge — um centro de
controle Angular único que expõe, de forma simples e visual, as
capacidades reais de cada Forja (instalação, hosts de IA, MCP, skills,
agents, tarefas, Graph Studio, documentação) sem substituir CLI, TUI ou
motores existentes.

- **Stack**: Angular 22 (standalone, signals, lazy routes) + servidor
  Python stdlib vendored em cada Forja. PT-BR e English nativos com
  troca imediata em runtime.
- **Distribuição**: `scripts/vendor.py` copia o bundle compilado e o
  módulo `_forge_portal.py` para cada repositório irmão; cada Forja
  serve o portal via `<cli> portal` — Node.js só é dependência de
  desenvolvimento aqui.
- **Contratos**: `forge/PortalApi/1` — ver `docs/fase0/contracts.md`.
- **Arquitetura e decisões**: `docs/fase0/architecture.md`.

## Desenvolvimento

```bash
npm install
npm start          # dev server com proxy para uma Forja local
npm run build      # dist/portal — artefato de release
npm test           # testes unitários
python -m pytest tests/   # testes do servidor vendored
python scripts/vendor.py  # propagar para os repos irmãos
```

## Princípios

Read-only por padrão; mutações seguem plan → review → confirm →
execute → verify → receipt; nenhum botão fictício; nenhum estado
inventado; o portal usa os mesmos serviços e produz os mesmos receipts
do CLI/TUI.
