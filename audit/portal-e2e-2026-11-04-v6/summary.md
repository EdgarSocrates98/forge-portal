# Product Forge Portal — E2E audit

Environment: local Product Forge portal on `127.0.0.1:4310`, managed Agent
Bridge paired locally, Chromium headless, 2026-11-04.

## Results

- 36/36 declared routes returned HTTP 200.
- 0 route-level navigation failures.
- All 15 `/pf` routes rendered without Angular runtime errors or bad API
  responses, including Chat Studio, diagnostics, intelligence and control
  center.
- Chat journey passed with the deterministic `fake` provider: session creation,
  host selection, model selection, SSE stream, prompt, assistant response,
  session timeline and mobile layout.
- Chat E2E evidence: `../portal-chat-2026-11-04/chat-final.json` and
  `../portal-chat-2026-11-04/chat-final.png`.
- Mobile viewport: 390x844, horizontal overflow: 0 px.
- Provider discovery observed Claude Code, Codex CLI, Devin CLI, GitHub
  Copilot CLI and fake provider. Devin was not prompted; no credential store was
  read or exported.

## Honest limitation

The generic Forge Portal shell still requests optional catalogs that Product
Forge does not implement (`/federation`, `/tasks`, `/versions`, `/hosts`,
`/skills`, `/agents`, `/mcp/servers`, `/metrics`, `/events`, `/graphs`,
`/lab`). They return typed 404s by contract and the UI now degrades to explicit
empty/unverified states instead of crashing. These are recorded as unsupported
surface, not as passing implementations.
