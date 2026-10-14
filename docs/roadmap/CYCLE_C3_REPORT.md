# Cycle 3 — Completion Report

Spec: `004-c3-portal-control-center` · Gate C3
Data: 2026-10-14

## Baseline

- Repositório: `forge-portal` (único repo modificado).
- Commit inicial: `e021903` (branch `cycle/c3-portal-control-center`, sobre F0).
- Capacidades existentes: servidor vendored byte-parity com op registry
  tipado + plan tokens + CSRF/session/rate-limit/redaction; 12 páginas
  lazy; `forge/PortalApi/1`; install Plan→Review→Apply→Receipt; palette
  só-nav; 11 testes ng + 45 pytest + 12 e2e Chromium.

## Implementação

- **Design system (§3.1)**: `ui-skeleton` (4 kinds, reduced-motion
  inerente), `ToastService`+`ui-toast-outlet` (aria-live, auto-dismiss,
  max 3, Escape), `ConfirmService`+`ui-confirm-host` (focus trap, Escape,
  backdrop, restore-focus, danger mode), `ui-filter-bar`; tokens
  aditivos `--z-overlay/dialog/toast`+`--skeleton`; tema light já
  completo (`:root`); page-enter animation cobre páginas novas.
- **Dashboard 360° (§3.2)**: cada seção é um `Source<T>` isolado —
  status, estatísticas, Forjas (federation), capabilities, inventário
  (skills/agents/mcp/hosts com contagens por endpoint), tasks recentes
  com falhas destacadas; refresh por seção + global, last-updated por
  fonte, data-source label; 404/PORTAL-NOT-FOUND → UNVERIFIED, outras
  falhas → ui-error com retry; falha parcial estruturalmente isolada.
- **Forja explorer (§3.3)**: `/forges` lista (serving + specialists +
  registry-only honesto) e `/forges/:id` detalhe (identidade, presença,
  checks, notas, inventário live para a servidora; campos ausentes →
  UNVERIFIED, nunca stub).
- **Installation Center (§3.4)**: exatamente os 9 passos — Discover →
  Select → Configure → Plan → Review Diff (diff field-level quando o
  backend envia; senão actions + nota explícita) → Confirm (passo
  explícito separado) → Execute (plan_token só entra aqui) → Verify
  (refresh + checks; ausentes → unverified) → Receipt (status, ações,
  refusal+unlock). Phase machine `idle→planning→review→confirming→
executing→verifying→receipt` impede pular Review/Confirm. Ops:
  reinstall (novo plano), repair (confirm danger), uninstall (danger),
  update → UNVERIFIED (adapter não expõe — honesto, não fabricado),
  histórico read-only via /tasks, comparação de perfis na página de
  profiles (diff lado a lado + apply via ConfirmService).
- **Configuration Center (§3.5)**: `/config` sobre `/environment` —
  estado (READY/PARTIAL/MISSING/INVALID), tabela de variáveis
  (name/required/present/valid\|unverified/kind/path), destaque de
  obrigatórias ausentes e inválidas; "preparar alterações" gera comandos
  PowerShell+bash copiáveis (toast no copy); valores NUNCA renderizados
  (o contrato já não os expõe); apply/backup → UNVERIFIED documentado
  (adapter não expõe escrita — caminho honesto: comandos copiáveis).
- **Global Search (§3.6)**: `SearchService` lazy — 9 kinds (pages/
  ações, forjas, capabilities, skills, agents, mcp, hosts, docs via
  /docs/search, erros conhecidos via recusas em tasks); ranking
  determinístico exact>prefix>substring + kind order + tie-break por
  label; isolamento por fonte (404 → kind ausente, erro → unverified);
  palette reescrita: grupos por kind, chips-filtro radiogroup roving
  (←/→ ativa), loading/empty states, footer, aria-activedescendant.
- Novas rotas `/config`, `/forges`, `/forges/:id`; nav +2 itens;
  `<ui-toast-outlet/>` + `<ui-confirm-host/>` montados no shell.

## Testes

- `npm ci` — PASS, 0 vulnerabilities.
- `npm run build` — PASS; initial 345.54 kB raw (baseline ~325 kB →
  +6.3%, justificado pelo control center); chunks lazy por página
  (forge-detail 15.35 kB, config 11.09 kB, explorer 7.55 kB); único
  warning: styles do install.page 6.67 kB vs budget 4 kB (warning,
  não erro — registrado P2).
- `npm test` (ng/vitest) — **108/108 em 14 arquivos** (+97 vs 11):
  skeleton/toast/confirm 21, dashboard 5, explorer 4, forge-detail 6,
  install 14, config 8, profiles 8, search.service 19, palette 12.
- `npx prettier --check "src/**/*"` — PASS.
- `python -m pytest tests/` — **45/45** (backend byte-parity intacto).
- `python -m pytest e2e/` — **15/15 em 56.5s** Chromium real: todas as
  rotas (incl. /config, /forges, /forges/self), stepper de 9 passos
  asserido, fluxo plan→review→confirm→execute→receipt ponta-a-ponta,
  config center, explorer+detail, palette agrupada, i18n toggle,
  mobile viewport, offline banner, zero console errors.
- **Gate C3**: portal exibe dados reais (federation registry +
  environment + adapters), navega entre 15 rotas, estados corretos
  (UNVERIFIED onde fonte ausente — provado: adapters sem federation
  renderizam badge explícito), e executa fluxo de instalação completo
  E2E com recibo — evidência: 15 e2e + screenshots em `e2e/artifacts/`.
  Zero demo fixtures em caminhos de produção (E2EAdapter só existe em
  `e2e/`).

## Segurança

- Segredos: contrato `/environment` expõe só metadados; nada de valor
  chega ao frontend; redaction server-side intacta (byte-parity).
- Plan/apply: binding plan_token+confirm honrado — token só flui no
  passo Execute após Review+Confirm explícitos.
- XSS/rendered-content: templates Angular interpolados (sanitização
  nativa); `icon.ts` bypass só com paths compile-time; palette não faz
  innerHTML de dados.
- A11y (WCAG 2.2 AA nos fluxos construídos): focus trap no confirm,
  roving tabindex nos chips, aria-live toasts, stepper aria-current,
  skip link preservado, reduced-motion em tudo novo.
- Pendências: `danger` confirm é um clique — operações destrutivas
  irreversíveis poderiam exigir texto datilografado (P2, alinhar com
  requisito de segurança do programa).

## Interoperabilidade

- CLI: portal nunca invoca CLI — todas as ops via forge/PortalApi/1.
- Portal: `forge/PortalApi/1` preservado — nenhum endpoint novo exigido;
  toda a UI vive sobre ops existentes (core + adapter). Adapters sem
  superfície → UNVERIFIED, nunca 500.
- Forjas: zero mudanças em adapters/Forjas — a superfície real
  (17 ops no api-forge) é consumida como está; campos novos no futuro
  degradam para UNVERIFIED, não quebram.
- Independência: portal continua opcional; serving Forja funciona sem
  federation, sem CLI, sem The Forge.

## Performance

- Baseline: bundle ~325 kB → 345.5 kB (+6.3% raw, +~6 kB transfer).
- Lazy: todas as páginas novas são chunks separados; palette/search
  é main mas só indexa sob demanda (debounce 250ms, cache por versão).
- e2e: 15 testes em 56s; paint inicial inalterado.

## Release readiness

- **PASS** — todas as ACs implementadas e evidenciadas; Gate C3
  cumprido com artefatos (15 e2e verde + screenshots + 108 unit).

## Pendências

- P0: nenhuma.
- P1: `install.page.ts` styles 6.67 kB excede budget de 4 kB (warning
  de build) — extrair padrões repetidos para styles.css ou aceitar
  budget dedicado.
- P2: apply/backup de configuração depende de adapters exporem op —
  proposta de contrato `forge/ConfigOps/v1` fica para C4 (adapters).
- P2: `update` de Forja via portal sem op real — quando adapters
  expuserem `update`, ligar o passo (hoje UNVERIFIED honesto).
- P2: confirmação destrutiva poderia exigir typed-confirmation além
  de um clique para uninstall (endurecimento).
- P3: `command-palette` não cobre a11y de anúncio de contagem de
  resultados via aria-live (resultados são listbox padrão).
