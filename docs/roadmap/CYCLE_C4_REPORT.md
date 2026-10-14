# Cycle C4 Report — Hosts / MCP / Agents / Skills

Spec: `factory/specs/active/005-c4-hosts-mcp-agents.md` · Branches: `cycle/c4-hosts-mcp-agents`
(forge-portal, forge-cli, api-forge) · Date: 2026-10-14

## Scope delivered

### §4.1 Host Integration Center (`/hosts`)

- Inventory per host: detected presence, `supported` badge, **tri-state auth**
  (`logged_in: null` → `UNVERIFIED`, never "authenticated"), integration
  lifecycle badge, `launchable`, `detail`, `command_hint`.
- Lifecycle stepper maps observed states onto ordered stages;
  `FAILED`/`BLOCKED` render terminal markers; unknown adapter strings render
  all-todo with the raw state still visible — no guessed stage.
- **Request integration** → `POST /hosts/launch` → outcome is a copyable
  command for the user's terminal, a verbatim refusal, or unavailable+detail.
  The portal never claims to launch a host; TTY-hosts are never started from
  the page.
- Verify = re-probe with transition bookkeeping (`from → to` badges +
  timestamp).
- Plan / inspect-files / fix / disable ops are **not exposed** by current
  adapters → each renders `UNVERIFIED` + "op not exposed by this adapter".
  No dead buttons.

### §4.2 Bridge study — ADR

`docs/roadmap/C4_BRIDGE_ADR.md` — evidence-based decision: **no separate
bridge**. The vendored backend + typed op registry already covers the
required local surface (hosts, MCP, skills, agents, tasks, graphs); the
remaining gap (plan/files/fix/disable host ops) is an *adapter capability*
gap, not a transport gap — a bridge would not supply it. Includes the
CLI↔Portal host-state mapping table; guarded on the CLI side by
`forge-cli/tests/hosts-mapping.test.ts` (pins the six-state ladder and
auth-verified-never-default).

### §4.3 MCP Operations Center (`/mcp`)

- Always-visible safety note: handshake verification is read-only; MCP tools
  are never auto-invoked (mutable tools never executed).
- Registry: id, state, host mapping (or "not host-bound"), `tools_count`
  (`null` → unverified, never zero), last verification, detail.
- Inspector per server: state explanation strings for the full progression
  `NOT_CONFIGURED → CONFIGURED → STARTING → HANDSHAKE_VERIFIED →
  TOOLS_DISCOVERED → INVOCATION_VERIFIED` + `DEGRADED`/`FAILED`.
- Tools/resources/prompts surfaces: count-only when names aren't exposed;
  `notExposed` → unverified; no fabricated surface.
- Compatibility report: observed state vs expected progression per server.
- Diagnostics: FAILED/DEGRADED servers with evidence + re-verify action.
- Latency labeled as portal-measured HTTP round-trip, not MCP protocol
  latency.

### §4.4 Agent Studio (`/agents`)

Real catalog metadata only: identity, role, description, authority,
domains, skills, hosts, state, origin Forja. Filters: text, domain, skill.
Rows for tools/MCP, permissions, dependencies, version render `UNVERIFIED`
when the adapter does not expose them.

### §4.5 Skills Studio (`/skills`)

Searchable real catalog: origin, version, compatibility, prerequisites,
file validation, dependencies, install state. Install/repair renders
`UNVERIFIED` where the adapter exposes no such op. **Deduplication**
(`core/catalog/dedup.ts`): same-name entries are never merged — compared by
namespace/origin/version/content and classified `possible-duplicate` or
`same-name-different-entity`, flagged for human review.

### §4.6 Capability matching (`/match`)

Answers "which agent / skill / Forja / MCP covers capability X" from real
catalog metadata (`core/match/match.service.ts`). Every result carries
evidence fields plus the explicit limitation that runtime capability is
unverified. Route `/match` is in the shell nav and global search.

## Adapter conformance fix (api-forge, same cycle)

`_frontmatter_field` returned the literal `>-` for YAML block scalars, so
every catalog description rendered a YAML marker. Now unfolds `>`/`|`
blocks; nested maps/sequences still return `None` (honest absence).
`api-forge` branch `cycle/c4-hosts-mcp-agents`, +2 tests (22/22 pass).

## Real evidence (api-forge adapter, this machine)

- **Hosts**: claude/devin/codex `detected:true, launchable:true` with
  terminal command hints; `integration:"unverified"` — no fabricated
  integration. copilot `detected:false, logged_in:null` → UNVERIFIED.
- **MCP**: server `apiforge` → `DEGRADED` with detail
  `"'apiforge-mcp' not resolvable on PATH — install incomplete"` — a real
  degraded state surfaced honestly, not a green badge.
- **Skills**: 14 real catalog entries; **Agents**: 26 real entries — now
  with real descriptions after the block-scalar fix.

## Verification

| Command | Result |
|---|---|
| `npm ci` | clean (install scripts blocked by npm policy; build unaffected) |
| `npm run build` | OK — only pre-existing `install.page.ts` 6.67 kB style warning |
| `npm test` | **171/171** across 21 files (+60 vs C3) |
| `npx prettier --check "src/**/*"` | clean |
| `python -m pytest tests/` | **45/45** |
| `python scripts/check_i18n.py` | 516 pt-BR / 516 en keys, 308 static keys |
| forge-cli `npm test` | **438/438** (+2 host-mapping contract guards) |
| api-forge `pytest tests/test_portal_adapter.py` | **22/22** |

## Files changed

- forge-portal: `pages/hosts|mcp|agents|skills|match/*` (+specs),
  `core/catalog/dedup.ts`, `core/match/match.service.ts`, `app.routes.ts`,
  `app.ts`, `core/search/search.service.ts`, `core/i18n/locales/*`,
  `docs/roadmap/C4_BRIDGE_ADR.md`, this report.
- forge-cli: `tests/hosts-mapping.test.ts`.
- api-forge: `src/apiforge/portal_adapter.py`, `tests/test_portal_adapter.py`.

## Risks / open items

1. Host plan/files/fix/disable ops remain `UNVERIFIED` until an adapter
   exposes them — surfaced, not hidden.
2. `hosts.launchable` wording could read as "portal launches"; mitigated by
   the outcome panel's "command for your terminal" framing.
3. MCP `tools_count` is `null` for the api-forge adapter — surfaces as
   unverified; tool/resource/prompt *names* are not exposed by any current
   adapter.
4. Capability matching searches catalog metadata only — runtime capability
   stays explicitly unverified per result.
5. Request-integration button stays enabled when `!launchable` so the
   adapter's refusal is the arbiter (one-line change if hard gating is
   preferred).
