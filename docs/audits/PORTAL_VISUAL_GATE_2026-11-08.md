# Portal visual gate — 2026-11-08

## Resultado

O gate local do Portal passou sem defeitos críticos observáveis:

- build de produção: PASS (`npm run build`);
- CLI: PASS (3/3 testes);
- instalação: PASS (2/2 testes);
- E2E: PASS (45 testes; 3 skips ambientais/documentados);
- axe: nenhum achado `serious` ou `critical`;
- foco: nenhum controle interativo sem indicador visual;
- clipping fora de contêineres de rolagem: nenhum caso sem `title`;
- overflow horizontal: 0 páginas;
- capturas auditadas: 214.

## Comandos reproduzíveis

```powershell
npm run build
npm run test:cli
npm run test:install
python -m pytest e2e -q
uv run --with playwright --with pytest python e2e/visual_probe.py --out audit/portal-visual-gate-2026-11-08-current
uv run --with playwright --with pytest python e2e/visual_audit.py --out audit/portal-visual-audit-2026-11-08-current
```

Os relatórios completos e as capturas ficam nos diretórios `audit/` gerados localmente. O gate não transforma truncamento intencional em defeito: labels longos em componentes que exibem `title`, skip-link e estados como “Sem workspace” continuam sendo avaliados como casos de usabilidade, não como overflow funcional.

## Limites da evidência

Este é um gate local do frontend em ambiente Windows. Ele não substitui validação de autenticação real, provedores externos ou execução distribuída em produção. Esses cenários permanecem dependentes das credenciais e serviços correspondentes.
