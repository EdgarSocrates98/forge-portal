# Instalação do Forge Portal

## Contrato operacional

O fluxo do portal segue `Plan → Review → Confirm → Execute → Receipt`.

O plano recebido pelo servidor mantém quatro decisões independentes:

- `scope`: `project`, `workspace` ou `user`;
- `hosts`: conjunto de hosts de IA selecionados;
- `component_profile`: `minimal`, `recommended`, `full` ou `custom`;
- `execution_profile`: `economy`, `balanced` ou `deep`.

`components` registra a seleção explícita de `skills`, `agents`, `mcp`, `tui` e `graph-studio`. O portal não executa uma alteração antes de exibir o plano e receber confirmação explícita. O recibo deve carregar estado, ações, token de plano e verificações disponíveis.

## Modos suportados

| Modo                | Evidência esperada                                             | Estado atual                                   |
| ------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Workspace com Git   | descoberta do workspace, plano, confirmação e recibo           | suportado pelo contrato                        |
| Workspace vazio     | recusa segura sem criar arquivos implícitos                    | coberto pelo contrato; validar contra backend  |
| Multi-repositório   | seleção de host/componentes por operação, sem misturar ledgers | contrato tipado; validação de backend pendente |
| Host não detectado  | estado `NOT_DETECTED`, sem label bruto                         | suportado no portal                            |
| Falha de integração | estado `FAILED` ou `BLOCKED`, ação explícita                   | suportado no portal                            |

## Regras de segurança

- Plano e recibo são dados do servidor; o cliente não inventa ações.
- Estado ausente permanece desconhecido; não é convertido em sucesso.
- Confirmação é separada de planejamento.
- Caminhos e comandos mostrados na interface permanecem evidência informativa; execução exige o fluxo do backend.
