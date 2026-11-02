# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | Portal is a separate runtime/distribution surface | README, `scripts/vendor.py` | users must know which server/package to start | package and launch it through `productforge install` |
| high | chat/board/product can become multiple mental models | `docs/fase0/contracts.md`, architecture docs | navigation and state fragmentation | one workspace shell backed by Product Forge domain API |
| high | cross-repo HTTP E2E is allowed to fail softly | `.github/workflows/ci.yml` (`|| true`) | CI can be green while sibling integration is broken | make system lane explicit, non-blocking first then release-blocking |
| medium | Angular and Python server parity has several gates | workflow and docs | fixes need synchronized release artifacts | one compatibility manifest and release check |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| vendored Portal API | sibling repos need checkout-independent runtime | `scripts/vendor.py`, `src/product_forge/_forge_portal.py` | semantic drift | publish versioned contract package or generated artifact |
| duplicated health/diagnostics concepts | each runtime reports its own state | docs/audits, UI | users cannot diagnose startup | aggregate health model in Product Forge |

### 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
|------|-----------------|----------|--------------------|-----|
| browser access to local services | A01/A05 | `docs/security/`, API contract | bearer/origin controls | one gateway and one token lifecycle |
| actions with local side effects | A04 | plan/review/confirm principle | explicit confirmation | consistent UI for Bridge approvals |
| secrets in screenshots/artifacts | A09 | `e2e/artifacts/`, audits | security docs | automated redaction proof |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| graph-heavy UI | Cytoscape dependency/docs graph reports | large graphs may tax browser | sluggish workspace | pagination/virtualization and measured budgets |
| several HTTP/event boundaries | architecture/docs | duplicated fetch/reconnect state | inconsistent UI | one gateway/event envelope |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|--------------|----------------------|
| `src/` feature shell | many UX/integration surfaces | extensive audit/e2e docs | incremental contract-first changes |
| `portal_core/` and vendor scripts | compatibility and security boundary | CI parity gates | keep generated artifacts reproducible |

### 6) `[ASK USER]` Questions

1. [ASK USER] Should the Portal remain independently launchable for developers, while non-technical users only see `productforge`?
2. [ASK USER] Is browser auto-open acceptable after installation, or should the command print a local URL only?

### 7) Evidence

- `README.md`
- `.github/workflows/ci.yml`
- `scripts/vendor.py`
- `docs/fase0/contracts.md`
- `docs/codebase/.codebase-scan.txt`
