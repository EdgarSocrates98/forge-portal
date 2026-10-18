# Portal 2.1 — Cycle 5: Product Experience & Personalization

Decisions and evidence for Cycle 5 of `prompt_evo_portal2.md` (§8.1–§8.5).
Everything below maps to real code — no speculative features, no fabricated
metrics.

## §8.1 Jornada guiada

Two surfaces, both discreet:

- **`/guide` — Portal guide** (`src/app/pages/guide/guide.page.ts`): nine
  concept sections (`start`, `forge`, `agent`, `skill`, `mcp`, `graph`,
  `install`, `diagnose`, `evidence`), each with an anchor id and deep-links
  to the *real* routes only. Registered in `app.routes.ts` and in the nav
  Overview group (`app.ts`, icon `guide` in `icon-paths.ts`). Also indexed
  by `SearchService` (`src/app/core/search/search.service.ts`) so it is
  discoverable via Ctrl+K.
- **`ui-guide-hint`** (`src/app/shared/guide-hint.ts`): one-line contextual
  hint rendered under `PageHeader` via its new `hintId` input, with a
  "learn more" deep-link to the matching `/guide#anchor`. Wired into nine
  pages: dashboard(`start`), explorer(`forge`), agents(`agent`),
  skills(`skill`), mcp(`mcp`), graph(`graph`), install(`install`),
  tasks(`diagnose`), execution(`evidence`). Dismissal persists in
  `PrefsStore.dismissedHints` — dismissed hints never reappear, so the UI
  carries no mandatory tutorial (prompt requirement).

## §8.2 Preferências

`PrefsStore` (`src/app/core/prefs/prefs.store.ts`) — one schema-versioned
localStorage record `forge-portal/prefs/v1` (`forge-portal/Prefs/v1`).
Strict parse: foreign schema or invalid typed field drops the record to
defaults; storage failure degrades to in-memory. Only non-sensitive state
is stored — documented in the file header and surfaced to the user in
Settings (`settings.privacy`).

| Prompt item | Implementation |
|---|---|
| Tema | `ThemeStore` (pre-existing: light/dark/system + Forge accent) |
| Idioma | `I18nService` (pre-existing: auto/pt-BR/en) |
| Densidade visual | `prefs.density` — `comfortable`/`compact`, applied as `data-density` on `<html>`; compact scale resolves in `tokens.css` |
| Layout do dashboard | Sidebar collapse `prefs.navCollapsed` (shell toggle + `[` key). Per-card dashboard rearrangement is **not** offered — the dashboard is a fixed information hierarchy; open question below |
| Filtros favoritos | `prefs.pageFilters` — per-page last filter text (skills, agents, match). "Favorites" as named sets is **not** implemented — open question below |
| Visualizações salvas | Graph Studio saved views (pre-existing `core/graph/saved-view.ts`) |
| Última área utilizada | `prefs.lastRoute` — recorded on every `NavigationEnd`, internal routes only (`isInternalRoute`); surfaced on the dashboard as a "last area" link |
| Preferências de animação | `prefs.motion` — `system`/`full`/`reduced`, applied as `data-motion`; `system` defers to `prefers-reduced-motion`, `reduced` collapses durations now, `full` is explicit opt-out of the OS reduce |

Settings exposes density, motion and a "show hints again" reset
(`src/app/pages/settings/settings.page.ts`).

## §8.3 Workspace experience

- Identification: the shell already shows the workspace name; the root path
  is now the tooltip on that label (`app.ts` — `store.workspace()?.root`).
- Forge state / context switching / relevant info: pre-existing
  (descriptor, health, capabilities, federation pages) — unchanged.
- Contextual navigation: guide hints + deep-links (§8.1) and the
  dashboard's "last area" link.
- Return to last selection: `prefs.lastRoute` above.
- Filter persistence: `prefs.pageFilters` wired into skills, agents and
  match pages; `?q=` deep-links always win over the stored filter.

## §8.4 Diagnósticos acionáveis

`error-guidance.ts` (`src/app/core/api/error-guidance.ts`) maps the real
`PORTAL-*` refusal codes to (explainKey, go route) pairs; `ErrorState`
(`src/app/shared/error-state.ts`) renders: translated explanation, the real
server `code`, a localized next-action link (when the code has a known
destination), the server-provided `action` verbatim, and the existing
retry — which is the verification path. Unknown codes render no invented
guidance. Known impact and safe-correction plans remain the responsibility
of the plan→confirm→execute surfaces that already render signed plans and
receipts (install, registry ops) — the error layer does not guess plans.

## §8.5 Walkthroughs

Step counts below are measured against the real UI (user actions: nav
click, field fill, button click, row/node selection). Time-to-completion,
errors and confusion points require real sessions and are **not** claimed
— see open questions. Redundant navigations and unnecessary commands are
assessed structurally.

| Scenario | Path | Steps |
|---|---|---|
| Instalar uma Forja | Nav → `/forges` → registry ops → fill id → Plan → review → Confirm+execute → receipt | 7 |
| Configurar host | Nav → `/hosts` → detect card → configure → verify | 4 |
| Verificar MCP | Nav → `/mcp` → select server → Verify handshake → status badge | 4 |
| Encontrar agente | Nav → `/agents` → type query → select card → detail | 4 (1 via Ctrl+K → agent) |
| Encontrar skill | Nav → `/skills` → type query → select row → detail | 4 (1 via Ctrl+K → skill) |
| Entender dependências | Nav → `/graph` → select node → evidence panel / impact analysis | 3 |
| Diagnosticar execução | Nav → `/tasks` → select task → timeline → replay events; on refusal the error state names code + next action | 4 |
| Consultar receipt | Nav → `/execution` (or install receipt in place) → select record → replay/detail | 3 |
| Comparar versões | Nav → `/versions` → select pair → diff view | 3 |

Every scenario stays inside the UI — no shell command is required. The
`/guide` page shortens the discovery step for beginners without adding
steps for experienced users (hints dismiss permanently).

## Open questions (not implemented — product decisions absent from the prompt)

1. **Dashboard layout rearrangement** — §8.2 lists "layout do dashboard".
   Implemented scope: persisted sidebar collapse. Reordering/resizing
   dashboard cards is a product decision (which cards are reorderable, is
   hiding allowed) with no spec — recorded here instead of invented.
2. **Named favorite filters / saved visualizations beyond graph views** —
   §8.2 lists "filtros favoritos" and "visualizações salvas". Implemented:
   last-filter persistence (skills/agents/match) + existing graph saved
   views. A named-favorites system is unspecified — recorded here.
3. **User-study metrics** — §8.5 asks to measure time, errors and
   confusion points. No user sessions were run; step counts above are
   structural. Real timing/confusion data needs an instrumented session —
   not fabricated.
4. **Context switching between workspaces** — §8.3 "troca de contexto
   quando suportada": the portal serves the workspace it was opened with
   (loopback session); multi-workspace switching is not a declared
   capability, so none was added.
