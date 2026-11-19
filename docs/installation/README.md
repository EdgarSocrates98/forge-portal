# Instalação do Forge Portal

## Classificação

O Forge Portal é um **host de UI vendored**, não uma Forja — ele não é
um provider do Forge Protocol e não implementa comportamento de
especialista. O servidor canônico (`portal_core/forge_portal.py`) e o
bundle Angular são propagados verbatim para as Forjas irmãs por
`scripts/vendor.py`; cada Forja serve o portal via `<cli> portal` e o
adapter dessa Forja é quem responde. O portal retransmite recibos das
Forjas **verbatim** — nunca fabrica resultado.

## Contrato operacional

O fluxo do portal segue `Plan → Review → Confirm → Execute → Receipt`.

O plano recebido pelo servidor mantém quatro decisões independentes:

- `scope`: `project`, `workspace` ou `user`;
- `hosts`: conjunto de hosts de IA selecionados;
- `component_profile`: `minimal`, `recommended`, `full` ou `custom`;
- `execution_profile`: `economy`, `balanced` ou `deep`.

`components` registra a seleção explícita de `skills`, `agents`, `mcp`, `tui` e `graph-studio`. O portal não executa uma alteração antes de exibir o plano e receber confirmação explícita. O recibo deve carregar estado, ações, token de plano e verificações disponíveis.

Em `/federation/plan` o plano recebe uma decisão adicional: `forge` — a
lista explícita de Forjas revisada pelo usuário. Uma lista vazia é uma
seleção vazia explícita (estado nomeado `empty_manual_selection`,
nunca ampliada para todas); `null`/ausente é o filtro "todas as
registradas" do motor. O `plan_token` vincula a lista exata aprovada.

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

## `forge/node-install/v1` × `forge/InstallReceipt/v1`

Dois schemas distintos que não se substituem:

- **`forge/node-install/v1`** — o *plano* emitido no stdout por
  `scripts/install_portable.mjs` (instalador portátil do próprio portal
  via `install.sh`/`install.ps1`). Descreve ações de instalação locais;
  é produzido por este repo e consumido por wrappers/humans.
- **`forge/InstallReceipt/v1`** — o *recibo* de instalação produzido
  pelo `install.service` da Forja servida e retransmitido verbatim pelo
  portal (`POST /installation/apply` → SSE). É evidência de execução
  real com estado, ações, `plan_token` e verificações — schema de
  propriedade da Forja, não do portal.

Resumindo: `node-install` é um plano de installer local do portal;
`InstallReceipt` é o recibo de execução de uma Forja.

## Precedência de `--root` / workspace

A workspace que o portal observa (membros, recursos, contexto) é a
raiz passada pelo **orquestrador** no lançamento do servidor — a opção
`--root` do `<cli> portal` de cada Forja, não um campo da UI. A página
`/install` instala a Forja servida na workspace efetiva; seleção de
outra Forja ou outra workspace acontece em `/federation` ou relançando
o servidor com outro `--root`. Tratar a precedência de `--root` é
responsabilidade do orquestrador/host que sobe o portal.

## Delegações declaradas (não-implementação intencional)

- **Context accounting por recurso** (tokens/bytes por recurso
  carregado, Context Observatory §20.4): `UNSUPPORTED` em todos os
  adapters — o portal exibe o que o adapter observa e marca o restante
  como `unverified`/`unavailable`. É uma delegação registrada (gap de
  homologação #1), não uma lacuna silenciosa.
- **`/events` (forge/PortalEvent/1)**: opt-in por adapter via
  `self.event_sink` + `telemetry.operations`; os adapters **instalados**
  já o montam (homologação VERIFIED ×7 em 2026-11-18) — adapters de
  checkouts mais antigos podem não expor o endpoint, que então responde
  `PORTAL-UNSUPPORTED` honestamente.
