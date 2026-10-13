# Onboarding da família de Forjas

Quando The Forge está instalado, a página **Família de Forjas** concentra o primeiro uso do ecossistema. Ela mostra o catálogo observado, as Forjas registradas, MCPs declarados e checkouts locais. O usuário escolhe as decisões uma única vez e recebe um plano federado para revisar.

## Escolhas do usuário

- **Escopo**: projeto, workspace ou usuário.
- **Host**: todos, nenhum ou um host específico entre Claude, Devin, Codex e Copilot.
- **Perfil de instalação**: Economy, Recommended ou Full.
- **Perfil de execução**: Economy, Balanced ou Deep.
- **Componentes**: skills, agents, MCP, TUI e Graph Studio.

Economy mantém o núcleo pequeno e deixa capacidades opcionais sob demanda. Recommended atende o caminho comum. Full habilita todos os componentes selecionados. Knowledge e evals continuam pertencendo ao pacote/registry de cada Forja; não são copiados indiscriminadamente para o projeto.

## Fluxo seguro

1. O portal consulta estado real em `GET /api/v1/federation`.
2. O usuário gera um plano em `POST /api/v1/federation/plan`.
3. O portal exibe escopo, host, perfis e ações previstas.
4. A aplicação exige o `plan_token` e confirmação explícita.
5. Cada Forja usa seu próprio instalador e devolve recibo verificável.

Nenhuma escrita acontece na geração do plano. Host `none` preserva arquivos de integração. Forjas não registradas aparecem como ausentes e não são executadas silenciosamente.

## CLI equivalente

O mesmo onboarding está disponível sem navegador:

```text
theforge setup
theforge setup --scope workspace --host none --profile minimal --gateway-profile economy --components mcp,tui --dry-run
theforge install auto --scope project --host claude --profile recommended --gateway-profile balanced --components skills,agents,mcp,tui,graph-studio --dry-run
```

O caminho interativo é preferível para novos usuários. Em automação, use `--dry-run` no primeiro passo e `--yes` somente depois de revisar o plano.
