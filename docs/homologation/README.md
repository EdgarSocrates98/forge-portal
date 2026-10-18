# Cycle 4 — Cross-forge homologation

Real per-forge verification of the `forge/PortalApi/1` surface. Every
locally-present forge is booted through its **real portal adapter
subprocess** — the same `<cli> portal` entrypoint a user gets — and
exercised over real HTTP. No fixtures, no synthetic events, no canned
responses.

## Artifacts

| File | Content |
|---|---|
| `cycle-4-matrix.json` | Machine matrix — `forge-portal/HomologationMatrix/v1`, one capability map per forge with status, detail and evidence pointers |
| `cycle-4-matrix.md` | Human matrix — capability × forge grid plus per-forge probe detail |

Regenerate (never hand-edit):

```bash
python scripts/homologation.py            # console matrix
python scripts/homologation.py --write    # refresh both artifacts
python scripts/homologation.py the-forge  # one forge only
```

Exit code is `1` while any `PARTIAL`/`BLOCKED` remains unexplained.

## Status vocabulary (closed)

| Status | Meaning |
|---|---|
| `VERIFIED` | Surface exercised; honest data **or a named refusal/state** came back. A real `FAIL` MCP receipt is data — the *surface* is what is verified, not the handshake outcome. |
| `PARTIAL` | Some probes verified, others failed or contradicted a declared capability (e.g. `capabilities` says `supported` but the op is absent). |
| `BLOCKED` | Probe could not run because a prerequisite failed (e.g. portal did not boot). |
| `UNSUPPORTED` | Op absent on this adapter (404 / `PORTAL-NOT-FOUND` / `PORTAL-UNSUPPORTED`) or declared `unsupported`. |
| `NOT_APPLICABLE` | Capability does not apply to this forge (e.g. `/federation` on a leaf specialist). |
| `NOT_TESTED` | Intentionally not exercised. |

## What is exercised per forge

`initialization · descriptor · capabilities · health · installation ·
profiles · hosts · skills · agents · mcp_servers · mcp_verify · graphs ·
tasks · knowledge · federation · versions · lab · telemetry ·
mutations · error_paths · unavailable`

- **Initialization** — the real adapter subprocess emits its
  `{"url": …}` startup contract and `/bootstrap` answers 200.
- **Installation** — `installation/status` + `registry/state` over HTTP,
  the `forge/InstallationManifest/v1` on disk, and a real
  `import <pkg>[.portal_adapter]` on the **installed venv python**
  (frozen copy independence).
- **Catalogs** — real lists; a 0-entry answer is honest data.
- **mcp_verify** — real MCP handshakes spawned by the adapter;
  `PASS`/`FAIL`/`BLOCKED` receipts are all `VERIFIED` surfaces.
- **tasks** — a real plan (`intent: "check the installation status"`)
  → real `plan_token` → real execute → real receipt.
- **federation / versions / lab** — `VERIFIED` on the-forge,
  `NOT_APPLICABLE` on leaf forges (cross-checked: a leaf answering 200
  would be flagged).
- **telemetry** — `/events` is contract-additive; adapters that never
  registered event-sink ops honestly read `UNSUPPORTED`.
- **mutations** — `NOT_TESTED` by policy: apply/repair/uninstall/
  profiles.apply/install-auto execute real changes. Only their
  *refusal boundary* is probed (missing confirm → `PORTAL-CONFIRM`,
  forged plan token → `PORTAL-PLAN-*`), under `error_paths`.
- **error_paths** — no session → 403; unknown op → 404
  `PORTAL-NOT-FOUND`; forged plan token; path traversal; missing
  required field.
- **unavailable** — a known-absent op stays a named 404, never a crash.

## Discovery order

`~/.forge/installations/<forge>.json` (manifest) → `install_root` +
venv python → sibling checkout (manifest `source.path` first, then
`$FORGE_ECOSYSTEM`, then every manifest's `source.path` parent). A
manifest-declared checkout only wins when it still has a `.venv`
python — a stale path is reported through evidence, never silently
preferred. `forge-doctor-api` boots its checkout-level
`scripts/forge_portal.py` against the installed venv's `forge_doctor_api`
package.

## Browser layer

`e2e/test_browser_homologation.py` (real Chromium, real `dist/` bundle):

- **`DegradedAdapter`** — a real adapter with genuinely failing
  backends: `/agents` unimplemented (404), `/skills` a real retryable
  503, partial host inventory with explicit UNVERIFIED holes, a real
  refused TCP handshake behind `mcp/verify` (FAIL receipt), a real
  `os.access` permission check behind `installation/apply` (403
  `E2E-PERMISSION-DENIED`), a real `shutil.which` probe behind
  `hosts/launch` (`PORTAL-HOST-ABSENT`), a declared incompatible-version
  health check, and a missing-forge route. Each renders a named code /
  UNVERIFIED badge / refusal card in the UI — nothing fabricated.
- **`test_theforge_federated_flow`** — the REAL `the-forge` adapter
  imported from its sibling checkout serving the CURRENT bundle through
  its own vendored server: discovery → capabilities → federation page →
  Graph Studio → agents/skills catalogs → real MCP verify receipt →
  back to the graph. Skips explicitly when the checkout is absent.

Independence in both directions is gated by
`tests/test_independence.py`: portal serving with zero forges,
installed packages importing without portal code, CLIs answering
`--version`, stdlib-only `portal_core`, no sibling-package imports, and
sha256-checked vendored `_forge_portal.py` copies.

## Open gaps (honest, as of the last run)

1. **`telemetry` = `UNSUPPORTED` on all 7 sibling adapters** — no
   vendored adapter registers `/events` ops yet. The forge-portal side
   is ready (`portal_core/telemetry.py`); the vendor layer is not.
2. **`mutations` = `NOT_TESTED` everywhere** — by policy; real
   apply/repair/uninstall are never executed by homologation. Refusal
   boundaries are verified under `error_paths`.
3. **the-forge vendors an older `_forge_portal`** (sha
   `899741fe…`, 979 lines vs 1111) — predates cycle-3 telemetry and
   `RequestContext.emit`; its adapter never emits `forge/PortalEvent/1`.
   Re-vendor via the-forge's own `scripts/vendor.py` flow when that
   repo takes a portal bump.
4. **Installed copies lag the checkouts** — the five installed
   site-packages copies share one older generation (`701cfe13…`);
   checkouts now carry `a968ad06…`. `tests/test_independence.py`
   asserts installed generations stay *consistent*; currency follows
   the next real install of each forge.
5. **mcp_verify receipts are real mixed outcomes** — the-forge
   `FAIL` (4/7 specialist handshakes passed), api-forge and
   platform-forge `BLOCKED` (`*-mcp` entrypoints not resolvable on
   PATH — install incomplete), spark-forge-aws `PASS` (146 tools),
   spark-forge-azure `PASS` (18), forge-doctor-data `PASS` (14),
   forge-doctor-api `PASS` (17). Every receipt is `VERIFIED` as an
   honest surface — the underlying BLOCKED installs remain an
   ecosystem gap, not a portal defect.
6. **`forge-cli` has no local checkout** — listed by the cycle-4
   prompt; only its `~/.forge-cli` registry state is observable.
   Registry ops are exercised through it, not a repo adapter.
