# FASE 1 — forge-portal core

Data: 2026-10-11. Branch: `feat/portal-ultimate-hardening`.

## GAP-004 — Task Center legível

`tasks.page.ts` renderizava `plan`/`receipt` como `<pre>{{ json }}</pre>`.
Agora:

- Plano em card estruturado: task, verbo, intenção, args (dl) — JSON bruto
  fica sob `<details>` "Avançado".
- Receipts/receipts de execução renderizados via **`ui-forge-doc`**
  (componente novo em `src/app/shared/forge-doc.ts`): status, metadados,
  checks (+repairable), drift, arquivos gerenciados/planejados, presença
  do Forge Portal, verificação, refusal/error + unlock + repair_hint,
  raw JSON colapsável. Reutilizável em qualquer página que receba um
  documento `forge/*`.
- `api.models.ts`: `InstallationReceipt` estendido com `task`,
  `checks` — tipos reais do payload do adapter.
- i18n: +26 chaves ×2 idiomas (283/283, gate `check_i18n.py` verde).

## GAP-002 — Playwright E2E real (não mocks)

`e2e/browser_e2e.py` — suite pytest + Chromium real:

- boota `PortalServer` (server de produção) em porta efêmera com
  `E2EAdapter` real — `default_operations` + `installation/plan` +
  `apply` com `plan_token` assinado + `mcp/verify` + `tasks/plan` +
  `tasks/execute` — servindo **o bundle real** de `ng build`.
- 10 testes: first paint, todas as 9 rotas, toggle pt/en, fluxo
  plan→apply, Ctrl+K, task plan card legível, mobile 390px, offline
  (server morre → shell degrada), zero pageerror, e o guarda novo abaixo.
- Screenshots → `e2e/artifacts/` (17 arquivos de evidência).
- Roda: `python -m pytest e2e/ -q` (skips limpos sem playwright/bundle).

## Bug crítico encontrado pelo E2E — shell sem estilo em produção

Os screenshots mostraram sidebar/chrome completamente sem estilo enquanto
componentes (inline) funcionavam. Cadeia causal confirmada:

1. `ng build` production roda **beasties** (inlineCritical): injeta um
   subconjunto inline e reescreve o `<link>` do `styles-*.css` como
   `media="print"` + `data-beasties-media="all"`.
2. O swap print→all depende de um `<script>` inline no fim do body.
3. O CSP do `portal_core` é `script-src 'self'` — **sem unsafe-inline** —
   então o script de swap é bloqueado e `media="print"` fica para sempre.
4. Resultado: **zero regras do stylesheet global aplicadas** — shell,
   nav, botões, cards, badges globais mortos em todas as 7 forjas
   vendored. Comprovado por CSSOM: regra `.shell{display:grid}` presente
   e casando, computed `display:block`; em iframe limpo a mesma folha
   aplicava `grid`.

Fix: `angular.json` production → `optimization.styles.inlineCritical:
false`. Folha carrega `media="all"` direto, sem script inline, CSP
estrito preservado (nenhum script inline no documento). Alternativa
(sha256 do script de swap no CSP) rejeitada: hash deriva a cada mudança
do snippet gerado pelo build — frágil, e em loopback o inline critical
não ganha nada mensurável.

Regressão coberta por `test_global_stylesheet_applies`: exige
`getComputedStyle(.shell).display === "grid"` e ausência de
`link[media=print]` — quebra se o mecanismo voltar.

## Verificação

- `python -m pytest e2e/browser_e2e.py` — **10/10** (antes do fix: teste
  novo falhava; depois: verde, screenshots provam shell estilizado).
- `python -m pytest tests/` — 37/37.
- `ng build` — limpo (budgets ok); `ng test` — 11/11.
- `check_i18n.py` — 283 pt-BR / 283 en.
- `vendor.py --check` — byte-parity server + manifest nos 7 destinos
  após re-vendor (bundle corrigido + `_forge_portal.py` com `_reject`
  propagados para todos os irmãos).

## Notas para as próximas fases

- `E2EAdapter` em `e2e/browser_e2e.py` é o modelo de adapter completo
  (descriptor/navigation/capabilities/health/ops mutating) — reutilizar
  por forja nas fases 2–8, trocando forge_id/ops de domínio.
- Toda forja vendored precisa re-baixar `portal/assets` — o bundle antigo
  nos irmãos carregava o bug do media=print; `vendor.py` já sincronizou
  (commit por repo nas fases 2–8).
