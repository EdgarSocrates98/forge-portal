# Evidências de teste

## Comandos

```powershell
npm run build
python scripts/check_i18n.py
npx ng test --watch=false --no-progress --isolate=false
python -m pytest tests -q
```

## Matriz de evidência desta onda

| Área | Resultado | Observação |
| --- | --- | --- |
| Build Angular | PASS | bundle de produção compilado |
| Paridade i18n | PASS | chaves EN/PT-BR verificadas pelo script |
| Testes Angular 11 | PASS | execução headless do conjunto existente |
| Testes Python | PASS | suíte do portal executada |
| Scroll vertical em viewport curta | PASS | `.content` mantém overflow interno e alcança conteúdo longo |
| PTY Windows real | BLOCKED | ambiente atual não fornece sessão ConPTY interativa reproduzível |
| Handshake de host real | BLOCKED | nenhum host externo autenticado no ambiente de CI local |
| E2E visual real | UNVERIFIED | artefato PNG pré-existente preservado; não representa nova execução |

`BLOCKED` e `UNVERIFIED` são estados de evidência, não equivalentes a `PASS`.

