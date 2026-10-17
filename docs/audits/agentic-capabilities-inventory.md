# Agentic capabilities inventory — Forge Portal NextGen

Descoberta real em 2026-10-17. Fontes verificadas: `~/.agents/skills` (1105),
`~/.claude/skills` (216), `~/.codex` (presente), profiles `run_subagent` do Devin.
Nenhum caminho de credencial inspecionado; apenas metadados de skills/agents.

## Especialistas selecionados (decisão: usar)

| Nome | Categoria | Origem | Caminho | Aplicabilidade | Decisão |
|---|---|---|---|---|---|
| frontend-ui-engineering | Frontend | ~/.agents/skills | `frontend-ui-engineering/` | arquitetura de componentes Angular | usar |
| angular-architect | Frontend | ~/.agents/skills | `angular-architect/` | revisão arquitetural Angular | consultar |
| frontend-design-deslop / anti-ui-slop | Visual | ~/.agents/skills | `frontend-design-deslop/` | qualidade visual, anti-genérico | usar |
| design-system (claude) | Design System | ~/.claude/skills | `design-system/` | tokens, escala, temas | usar |
| motion-system / animation-principles | Motion | ~/.agents/skills | `motion-system/` | durações, easing, reduced-motion | usar |
| visual-hierarchy | Visual | ~/.agents/skills | `visual-hierarchy/` | hierarquia/scan do dashboard | usar |
| accessibility-audit/-scan/-fix/-test-plan | A11y | ~/.agents/skills | `accessibility-*/` | WCAG 2.2 AA, foco, SR | usar |
| playwright / playwright-generate-test | E2E | ~/.agents/skills | `playwright*/` | e2e + testes visuais | usar |
| security-review / threat-model-analyst | Segurança | ~/.agents/skills | `security-review/` | CSP, CSRF, allowlist | usar |
| webapp-testing (claude) | QA | ~/.claude/skills | `webapp-testing/` | verificação em browser real | usar |
| graphify | Grafos | ~/.claude/skills + MCP tokensave | `graphify/` | code-graph do próprio portal | consultar |
| tokensave (MCP) | Contexto | MCP server `tokensave` | — | exploração econômica do código | usar |

## Subagent profiles reais disponíveis (run_subagent)

| Profile | Papel no programa |
|---|---|
| UI Designer / ui-designer | tokens, hierarquia, acabamento |
| UX Researcher / ux-researcher | auditoria de fluxos, carga cognitiva |
| Frontend Developer / frontend-developer | implementação Angular |
| Accessibility Auditor / accessibility-tester | WCAG, teclado, screen reader |
| Performance Benchmarker | medição de render/bundle |
| Code Reviewer / code-reviewer | revisão independente (review gate) |
| Test Automation Engineer / test-automator | Playwright, flake elimination |
| Data Visualization Engineer | encodings de grafo, paletas |
| ui-ux-tester | walkthroughs com browser |
| subagent_general / subagent_explore | workers genéricos / leitura |

## Hosts detectados

Devin CLI (este executor), Claude Code (`~/.claude`), Codex (`~/.codex`).
MCP: `tokensave` ativo (code-graph de forge-cli, forge-doctor-*, forge-portal,
platform-forge). Sem Cursor/Copilot config relevante detectada.

## Não encontradas / registradas como ausentes

Sem skill dedicada a Cytoscape/Sigma/ELK — decisão de renderer exigirá PoC
com benchmark próprio (Cycle 2 §5.2). Sem tool de screenshot dedicada —
playwright cobre. Esses gaps serão cobertos por capacidade nativa + registros.
