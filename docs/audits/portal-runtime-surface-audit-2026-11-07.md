# Portal runtime surface audit — 2026-11-07

## Resultado

O problema funcional confirmado nos screenshots era o Graph Studio tratar a ausência opcional de `GET /api/v1/graphs` como erro fatal de página. O adapter degradado devolvia uma resposta válida para as fontes federadas, mas o Portal exibia `ui-error` e sugeria que o usuário abandonasse uma tela que ainda tinha dados reais e ações disponíveis.

Isso foi corrigido para separar:

- estado da Forja que fornece o grafo (`disponível`, `sem grafo`, `indisponível` ou `não verificado`);
- estado de cada fonte federada, preservando a evidência individual;
- estado operacional do Graph Studio, que continua navegável quando outras fontes responderam.

Quando uma Forja não expõe o endpoint de grafo, o usuário agora vê a causa, a orientação de recuperação e a garantia de procedência: o grafo federado usa somente fontes que responderam. Busca, filtros, seleção, snapshot e exportação continuam disponíveis.

Também foi corrigido o teste de interação do canvas: a área real do grafo é rolada para a viewport antes do sweep de ponteiro. O teste anterior calculava coordenadas fora da viewport em páginas densas e reportava uma falha que não representava uma interação possível do usuário.

## Evidência visual

- Screenshot degradado atualizado: `e2e/artifacts/c4-08-degraded-graph.png`
- Auditoria visual: `audit/portal-visual-runtime-2026-11-07/audit-metrics.json`
- Reflow e zoom: `audit/portal-visual-runtime-2026-11-07/reflow/reflow-cycle5.json`
- Probe de contraste, foco e axe: saída em `audit/portal-visual-runtime-2026-11-07/probe`

O screenshot confirma que a ausência do endpoint fica confinada ao card “Grafo fornecido pela Forja”, enquanto o card “Grafo federado do ecossistema” segue acionável.

## Validações executadas

| Verificação | Resultado |
| --- | --- |
| Build Angular | passou |
| Prettier | passou |
| i18n | 1.398 chaves em PT-BR e EN; passou |
| Testes unitários | 589 passaram em 54 arquivos |
| E2E completo | 45 passaram; 3 opcionais ignorados |
| Homologação | 10 passaram |
| Graph E2E | 10 passaram |
| Usabilidade | 9/9 passos; 93 teclas; 0 fricções |
| Auditoria visual | 214 capturas; 0 overflow de página; 0 bad clips |
| Contraste/foco/axe | 0 clipping sem escape; 0 foco sem anel; 0 axe sério/crítico |
| Reflow | 252 capturas: 3 zooms × 4 viewports × 21 rotas; 0 overflow; 0 bad clips |
| Modos de acessibilidade | sistema/forçado, contraste e movimento reduzido passaram |

Os 144 casos de texto marcado como “clipped” no reflow são conteúdos longos confinados em tabelas/cards e possuem título ou rolagem interna; nenhum foi classificado como clipping ruim fora de um escape acessível.

## Decisão de produto

Estados `indisponível`, `não verificado` e `não encontrado` continuam visíveis quando o backend realmente não fornece prova. Eles não foram mascarados com dados sintéticos. A melhoria é que cada estado agora explica sua origem e próxima ação, sem bloquear o restante do Portal.
