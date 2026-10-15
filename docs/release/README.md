# Release e produtização

## Entrega desta onda

- contrato TypeScript para seleção de instalação;
- separação entre perfil de componentes e perfil de execução;
- estados de ciclo de vida de host com tradução EN/PT-BR;
- labels sem vazamento de estado bruto de integração;
- documentação de instalação, testes e evidências.

## Critérios de promoção

1. Build e testes locais verdes.
2. CI do pull request verde.
3. Nenhum `BLOCKED` apresentado como sucesso.
4. Backend compatível com `InstallSelection` e recibo verificável.
5. Validação PTY/host real registrada em evidência separada antes de anunciar suporte produtivo.

## Limitações conhecidas

O portal tipa e apresenta os contratos, mas a confirmação de que cada backend irmão persiste todos os campos deve ocorrer nos testes de integração correspondentes. A execução em hosts reais e a validação ConPTY permanecem pendentes por limitação do ambiente atual.
