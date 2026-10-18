# Cycle 2.2.2 — Release Dumps Security Review

Subject: `scripts/release_dumps.py` (1212 lines, "Portal 2.2.1 Cycle 2 — safe diagnostic dumps"). Review = code audit (independent subagent) + live `--check` run (this session).

## Live execution evidence

`python3 scripts/release_dumps.py all --repo-dir . --forges-dir .. --out /tmp/forge-222/dumps --check` → exit clean:

- wrote `release-inventory.json`, `vendor-integrity.json`, `release-summary.md`, `checksums.sha256` (3 entries)
- `wheel-manifest.json` / `npm-pack-manifest.json` skipped correctly (no `--artifact`/`--npm-dir` given)
- output corpus grepped for `ghp_`, `AKIA`, PEM blocks, `password|token *[:=]<value>` → **zero hits**

Generated artifacts committed as the cycle's minimal dump: `docs/audits/forge-2.2.2-dump/`.

## What it collects

`release-inventory.json` (repo/commit/tag/package/workflows/platform; git metadata only), `vendor-integrity.json` (sibling checkouts vs `portal/manifest.json` sha256s), `wheel-manifest.json` (member list + sha256 + parsed METADATA), `npm-pack-manifest.json` (`npm pack --dry-run --json --ignore-scripts`), `release-summary.md` + `checksums.sha256`. Raw file contents are never emitted; wheel metadata is parsed and scanned, not copied verbatim.

## Sanitization verified

- `sanitize()` applied to **every** emitted document (`write_json`) and the summary.
- `USER_PATH_RE` → `<HOME>`; `SECRET_RES` → `<REDACTED>` covering `ghp_/gho_/ghu_/github_pat_/glpat-/AKIA/xox[baprs]`, `Bearer`, and generic `password|secret|api_key|token|access_token|auth_token|refresh_token|session_token|private_key` k=v forms.
- `FORBIDDEN_BASENAME_GLOBS` (`.env*`, `*id_rsa*`, `*.pem`, `*token*`, `*secret*`, `*credential*`) and `FORBIDDEN_SEGMENTS` (`.git`, `__pycache__`, `test-results`) flagged in listings; `.git` never traversed; git credentials never read.
- remote URLs userinfo-stripped (`sanitize_remote`); wheel metadata text scanned for user paths + secret shapes before being recorded (as `<REDACTED>` findings).
- `--mode extended` adds hostname + CI env-var **presence only** (never values) with a stderr warning.
- `--check` exits 1 on findings/drift/errors — usable as a gate.

## Gaps found (severity-ordered)

| # | Gap | Sev |
|---|---|---|
| D-1 | `SECRET_RES` missed AWS `aws_secret_access_key`/`aws_session_token` k=v, `-----BEGIN … PRIVATE KEY-----` blocks, `npm_`/`pypi-`/`AIza`/`ya29.` token shapes, `client_secret`/`webhook_secret` k=v. **Fixed in this PR** (patterns added + verified: each synthetic redacts; `version = 0.5.2` unaffected; `--check` still clean on real output). Standalone unlabeled 40-char AWS secrets remain uncovered by design (key-name match only — a bare-entropy matcher would false-positive on hashes; recorded as accepted residual). | ~~P1~~ FIXED |
| D-2 | No post-write self-scan of emitted files — every write funnels through `sanitize`, so residual risk is pattern coverage only, but a second net would catch miss-pattern leaks. | P2 |
| D-3 | `forge-doctor-data/tools/env_manifest.py` writes raw `sys.executable` (absolute path with username) into `dist/env-manifest.json` which ships in RC artifacts. Minor path/PII leak. | P2 |
| D-4 | `the-forge/scripts/reality/collect.py` records interpreter paths into `specialist-reality.json`; no redaction (but `_MINIMAL_ENV` allowlist for subprocesses is good). | P3 |
| D-5 | `--mode extended` emits `platform.node()` (hostname); artifact `path` fields may hold non-home absolute paths. | P3 |

## Verdict

**PASS** — the dump pipeline is structurally safe (no raw contents, sanitize-everything, exclusion lists, `--check` gate, clean live run) and D-1 is fixed in this PR. Optional D-2 post-write self-scan remains a defense-in-depth suggestion (P2). No secrets were exposed by this cycle's dump.
