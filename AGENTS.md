# AGENTS.md — working in this repository

Forge Portal is the **vendored UI host** of the Forge ecosystem: an
Angular 22 SPA plus the canonical stdlib server `portal_core/forge_portal.py`,
propagated verbatim into the sibling forges (`_forge_portal.py`) by
`scripts/vendor.py`. It is **not** a Forge-Protocol provider and must
never become one — it relays each forge's adapter data; it does not
implement specialist behavior.

## Invariants (breaking any is a defect, not a style)

1. **Honesty over completeness** — `Source<T>` tri-state; `unavailable`,
   `unverified`, `unresolved`, `BLOCKED` are named states, never hidden.
   No path reports success without a real execution result; the portal
   relays sibling receipts **verbatim** and never fabricates data.
2. **Byte-parity vendoring** — `portal_core/forge_portal.py` is vendored
   verbatim; satellite opt-in modules ship as `_portal_telemetry.py` /
   `_portal_atlas.py`. Changing the canonical file requires
   `python scripts/vendor.py` propagation in a joint workspace plus a
   `KNOWN_PREV_GENERATIONS` update in `tests/test_independence.py`
   (one documented lag generation per pending re-vendor).
3. **Single version track** — `package.json#version`,
   `PORTAL_VERSION` in `portal_core/forge_portal.py` and the CLI's
   reported version never diverge (`tests/test_version_track.py`).
   Do not bump without a documented rationale.
4. **Loopback security model** — session token, Origin + Content-Type
   CSRF guard, Host-header guard, body cap, mutation rate limit,
   one-time HMAC `plan_token` (anti-replay), secret scrub on every
   response, traversal/symlink guards, CSP, zero shell in the
   canonical server. Mutations are `plan → review → confirm → execute`
   only; the UI never widens what the CLI contract allows.
5. **Deterministic, stdlib-only core** — `portal_core/` imports nothing
   outside the Python stdlib and never imports a sibling forge package
   (`tests/test_independence.py` enforces both).
6. **Additive contracts** — `forge/PortalApi/1` evolves additively;
   absent capabilities surface as `unavailable`/`PORTAL-UNSUPPORTED`,
   never breaking changes. Unknown fields pass through.
7. **i18n parity** — every user-facing string exists in `pt-br` and
   `en`; the gate is `python scripts/check_i18n.py`.
8. **Generated state is never committed** — `.codebase-memory/`,
   `.tokensave/`, `.forge/`-style outputs and `e2e` run artifacts are
   tooling state (the `e2e/artifacts/` baselines are the exception:
   only update them on intentional visual changes).

## Gates before commit

```bash
python -m pytest -q                 # python side (e2e/ needs Playwright)
npm test                            # vitest unit suite
npm run build                       # production bundle (vendorable)
npm run test:cli                    # tools/portal-cli.mjs contract
npm run test:install                # portable installer contract
python scripts/check_i18n.py        # i18n parity gate
python scripts/vendor.py --check    # vendoring drift gate (see docs)
python scripts/homologation.py      # real-forge matrix, when runnable
ruff check .                        # lint (portal_core/forge_portal.py excluded — byte parity)
npx prettier --check "src/**/*"     # canonical style
```

## Layout

- `portal_core/` — canonical server + opt-in satellite modules
  (`telemetry.py`, `atlas_ops.py`, `registry_ops.py`)
- `src/app/` — Angular SPA (standalone, signals, lazy routes, zoneless)
- `tools/portal-cli.mjs` — portable terminal companion (Node built-ins only)
- `scripts/vendor.py` — vendoring pipeline + drift gate (`--check`)
- `scripts/homologation.py` — real-forge homologation matrix
- `tests/`, `e2e/` — pytest suites; `docs/` — see `docs/README.md`

## Commits

Conventional commits + `Signed-off-by` (DCO — see `CONTRIBUTING.md`).

More context: `docs/fase0/architecture.md`, `docs/fase0/contracts.md`,
`docs/fase0/security-matrix.md`, `docs/homologation/README.md`.
