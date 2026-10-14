# Cycle C5 — §5.7 Operational Security Matrix

Spec: §5.7 operational security checklist · Branch: `cycle/c5-operations` ·
Suite: `tests/test_security_c5.py` (24 tests, stdlib-only pytest against the
vendored `portal_core/forge_portal.py` over real HTTP — urllib + threads,
same fixture pattern as `tests/test_forge_portal.py`) · Date: 2026-10-14 ·
Result: **24/24 pass** (`python -m pytest tests/test_security_c5.py -q`),
**69/69** full suite — no regression.

Verdicts: **PASS** = control exists and the test asserts it (regression
guard); **PASS (observed)** = no dedicated control exists and the test pins
the real observed behavior; **UNVERIFIED** = surface absent — asserted absent,
cannot be exercised.

| # | §5.7 item | Control in vendored backend (evidence) | Test | Verdict |
|---|---|---|---|---|
| 1 | Session expiration | No time-based expiry by design — `_session_ok` is pure constant-time compare (`forge_portal.py:457`); token is per-boot `secrets.token_urlsafe(24)` (`:780`), so process restart revokes. Foreign/stale token and forged-cookie mismatch → 403 `PORTAL-SESSION`. | `TestSessionToken::test_foreign_session_token_rejected`, `::test_cookie_session_mismatch_rejected`, `::test_session_has_no_time_expiry` | **PASS (observed)** — invalid/foreign-token rejection verified; TTL absent, pinned in code |
| 2 | CSRF | Mutating ops require literal `confirm` → 400 `PORTAL-CONFIRM` (`:577`); POST requires `Content-Type: application/json` → 415 `PORTAL-CONTENT-TYPE` (`:541`) — kills simple-form CSRF. | `TestCsrfConfirm::test_mutating_post_without_confirm_rejected`, `::test_form_style_post_rejected` | **PASS** |
| 3 | Origin validation | POST Origin allowlist = loopback hosts only → 403 `PORTAL-ORIGIN` (`:469`,`:534`); suffix-spoof (`127.0.0.1.evil.example`) and `null` origin rejected. | `TestOriginValidation::test_non_loopback_origin_rejected` | **PASS** |
| 4 | Host-header validation | Loopback-only Host enforced pre-route for GET+POST+static → 403 `PORTAL-HOST` (`:476`,`:488`,`:499`) — DNS-rebinding guard. | `TestHostHeader::test_non_loopback_host_rejected`, `::test_foreign_host_rejected_before_routing` | **PASS** |
| 5 | Rate limit | `RateLimiter` — 10 mutating ops / 60 s sliding window → 429 `PORTAL-RATE-LIMITED`, retryable (`:743`,`:548`). Hammer bounded at 15 calls. | `TestRateLimit::test_mutating_endpoint_429_within_bound` | **PASS** |
| 6 | Path traversal | `..` normalized + refused hard; `resolve()` + `relative_to()` containment (`:668-679`) → 404 for raw/encoded/double-encoded/backslash probes. Extension-less escapes hit SPA fallback = still contained. | `TestPathTraversal::test_traversal_variants_rejected` | **PASS** |
| 7 | Symlink escape | `resolve()` + `relative_to(assets.resolve())` — file symlink and dir junction out of root → 404, secret bytes never served (this host: `os.symlink` privilege available; test falls back to junction/skip-with-reason elsewhere). | `TestSymlinkEscape::test_symlink_escape_contained` | **PASS** |
| 8 | RCE | No shell/exec primitive in module (source scan: no subprocess/os.system/os.popen/eval/exec/pty); ops are typed callables. Shell-metachar body fields round-trip as verbatim strings; probe file never created. | `TestRce::test_shell_metacharacters_are_inert_data`, `::test_no_exec_primitives_in_module` | **PASS** |
| 9 | SSRF | No outbound-fetch primitive exists (no urllib.request/http.client/requests/socket.connect — `socket` used only for loopback bind in `free_port`). `socket.connect` spy during a `host=http://169.254.169.254/` request records loopback only; the URL reaches the handler as inert data. | `TestSsrf::test_host_field_never_fetches` | **PASS** |
| 10 | Log injection | Logs carry only the raw requestline (percent-encoding preserved — `%0d%0a` can never materialize as a line break) plus handler error type names; request bodies never logged (`:402`,`:620`). | `TestLogInjection::test_crlf_cannot_forge_log_lines` | **PASS** |
| 11 | Secret leakage | `redact()` — key-name allowlist (`token|secret|password|cookie|authorization|api_key|apikey|credential` → `«redacted»`), recursive, `plan_token` exempt (`:50-55`,`:377-390`); applied to JSON and SSE. Boundary pinned: key-name-based only — a secret-shaped value under a benign key passes through. | `TestSecretLeakage::test_secret_keys_redacted_in_response`, `::test_redact_boundary_is_key_name_based` | **PASS** — boundary documented |
| 12 | Plan replay | Tokens are NOT single-use: same token re-applies within TTL → 200. Idempotent-safe — HMAC binds the exact plan, so replay can only re-execute the identical action set (see #14). | `TestPlanReplay::test_plan_token_replay_is_idempotent_bound` | **PASS (observed)** — idempotent-safe, not single-use |
| 13 | Expired plan | `check_plan_token`: 900 s TTL + plan-hash + HMAC-SHA256 over canonical JSON (`:357-370`); validly-signed stale token (ts−1000 s) → 409 `PORTAL-PLAN-STALE`; garbage/forged → 400/409. | `TestPlanExpiry::test_stale_plan_token_rejected`, `::test_forged_plan_token_rejected` | **PASS** |
| 14 | TOCTOU plan→apply | Token = HMAC over the exact plan — token minted for scope=account plan cannot satisfy an apply that verifies scope=project → 409, no state change. | `TestToctou::test_plan_a_token_cannot_apply_plan_b` | **PASS** |
| 15 | Cancellation | **No cancel primitive exists**: `Operation` has no cancel/lifecycle field, no registered or guessed cancel route answers (404 `PORTAL-NOT-FOUND`). | `TestCancellation::test_no_cancel_operation_surface` | **UNVERIFIED** — surface absent; only its absence is assertable |
| 16 | Concurrency | `ThreadingHTTPServer` + `ThreadPoolExecutor(8)` + locked rate limiter (`:784`,`:748`). 12 parallel mutating calls → exactly 10×200 + 2×429, every response a valid `forge/PortalApi/1` envelope, counter ops serialized 1..10 (no lost updates), server healthy after. | `TestConcurrency::test_parallel_mutations_bounded` | **PASS** |
| 17 | Resource exhaustion | `Content-Length > 1 MiB` → 413 `PORTAL-PAYLOAD-TOO-LARGE` before the body is read (`:560-566`); exactly-1 MiB boundary admitted; reject path drains pending body (`_reject`,`:432`). | `TestResourceExhaustion::test_payload_cap_boundary` | **PASS** |

## Genuinely missing / limited controls (findings, not silent passes)

1. **Session tokens have no TTL** — expiry is "process lifetime" only; a
   stolen token stays valid until server restart. Consistent with the
   documented local-single-user model (`docs/fase0/security-matrix.md`
   decisions) but flagged: no idle/absolute timeout exists.
2. **Plan tokens are not single-use** — replay within the 15-min TTL
   re-executes. Safe today because the token binds the identical plan
   (#14), but there is no nonce consumption if a future op needs
   apply-at-most-once semantics.
3. **Redaction is key-name-based** — a secret-shaped *value* under a benign
   key name passes through unredacted. Adapter authors must not return
   secrets under non-secret field names; no value-pattern scan exists.
4. **No cancellation surface** — no `Operation` cancel field and no cancel
   route; long-running ops can only be bounded by per-op `timeout`.
5. **Static 404s lack security headers** — traversal/missing-asset refusals
   go through `BaseHTTPRequestHandler.send_error` (plain HTML, no
   CSP/nosniff/no-store). Cosmetic on an error page, noted for completeness.
