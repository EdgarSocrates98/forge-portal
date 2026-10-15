# Forge Portal — Mapa de capabilities ×7 (FASE 0 audit)

Fonte: audit real dos checkouts (CLI verbs, manifests, services) — mesma
varredura da matriz de aceite do Ultimate Completion.

| capability        | the-forge            | api-forge                  | spark-aws                    | spark-azure                  | platform                   | doctor-data       | doctor-api               |
| ----------------- | -------------------- | -------------------------- | ---------------------------- | ---------------------------- | -------------------------- | ----------------- | ------------------------ |
| install lifecycle | installkit + ledger  | installkit                 | installkit                   | installkit                   | installkit                 | installkit        | scripts/ (checkout)      |
| hosts observe     | `hosts observe`      | `ai` flow                  | `ai` flow                    | `ai` flow                    | `hosts`                    | `hosts`           | `forge_hosts.py`         |
| host launch       | `hosts launch` (TTY) | `ai --launch`              | `ai --launch`                | `ai --launch`                | `hosts --launch`           | `hosts --launch`  | `--launch`               |
| MCP verify        | registry+invoke      | `mcp-verify`               | `mcp-verify`                 | `mcp-verify`                 | `mcp-verify`               | `mcp-verify`      | `mcp-verify`             |
| skills catalog    | 33 canonical         | 14                         | 60                           | 22                           | 12                         | —                 | —                        |
| agents catalog    | 8 AgentSpec          | 31                         | 19                           | 40                           | 41                         | —                 | —                        |
| task/exec         | `task`, `ask`        | `analyze`, `judge`, `task` | `analyze`,`diagnose`,`judge` | `analyze`,`diagnose`,`judge` | `analyze`,`judge`,`policy` | `scan`,`diagnose` | `scan`,`diff`,`diagnose` |
| graph view        | `graph`+federated    | `graph view`               | `graph view`                 | `graph view`                 | `graph view`               | `graph view`      | `graph <dir> --view`     |
| docs catalog      | knowledge-program    | docs inventory             | commands.generated           | docs index                   | manifest                   | learn recipes     | learn recipes            |
| profiles          | components           | components                 | components                   | components                   | components                 | components        | components               |
| TUI               | command-center       | home+wizard                | menu                         | menu                         | menu                       | menu              | menu+sentinelas          |

## Perfis (economy / balanced / full)

Mapeamento sobre `components` do install service — o portal apenas
preset-eiona o subconjunto: economy = mínimo operante; balanced =
defaults recomendados; full = todos compatíveis. O diff vem do plan
receipt real — nunca de tabela inventada.

## Serviços reutilizados pelo adapter (sem reimplementação)

- `install.service`: status/plan/apply/repair/uninstall + ledger.
- `hostflow`/`forge_hosts.py`: observe (detect/version/auth/integration).
- `mcp-verify` handshake in-process quando o pacote `mcp` está no venv.
- `graphview.build_view` + `_graphstudio` documento HTML.
- `expected_skill_mirrors`/`expected_agent_mirrors` → estado por item.
- `docs/knowledge-program/inventory.jsonl` → busca local.
- the-forge: `specialists.collect`, `capabilities`, `ask`, `task`.

## Lacunas conhecidas (honestas)

- `forge-doctor-*` sem agents/skills canônicos → explorer mostra
  `NOT_APPLICABLE`, não botão morto.
- Copilot: sem auth-status → `logged_in: null`.
- fda `graph` é target-scoped — a view do portal usa o target do
  workspace, não o dialeto CLI.
