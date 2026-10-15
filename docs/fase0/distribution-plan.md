# Forge Portal — Plano de distribuição (FASE 0)

## Fluxo do usuário final

```text
git clone <forge>  →  ./setup.sh  →  <cli> portal  →  browser abre
em 127.0.0.1:<porta> com sessão — sem Node.js, sem build, sem rede.
```

- `portal/assets/` viaja no checkout e no wheel (`package-data`).
- `_forge_portal.py` é vendored; `portal_adapter.py` é do repo.
- `portal` aparece no help/TUI/menu com rationale próprio.

## Pipeline de release do portal

```text
forge-portal repo
  ng build → dist/portal/(hashed chunks + index.html + i18n)
  scripts/vendor.py
    → grava manifest.json {arquivo: sha256}
    → copia _forge_portal.py p/ src/<pkg>/ de cada repo
    → copia dist p/ <repo>/portal/assets/
  teste de paridade por repo: byte-compare do módulo + manifest
```

Regras:

- Assets só são servidos se o `manifest.json` conferir (sha256 por
  arquivo) — integridade de distribuição, não só cache-bust.
- Versionamento: `PORTAL_VERSION` no módulo; descriptor expõe
  `portal_version` — upgrade = re-vendor + commit por repo.
- Fallback honesto: assets ausentes/corrompidos → `portal` recusa com
  instrução (`PORTAL-ASSETS-MISSING`), nunca página quebrada.

## Verbo `portal` por Forja

```text
<cli> portal [--port N] [--no-browser] [--json]
```

Receipt: `{status, url, port, assets_version, refused?}`; encerrar =
Ctrl+C (SIGINT gracioso, sessão expira com o processo).

## Branching

- `forge-portal` repo novo: `main` protegido por revisão; trabalho em
  `feat/portal`.
- Cada Forja: `feat/forge-portal` ramificada do trabalho atual
  (`feat/ultimate-completion`), PRs separadas por repo — sem misturar
  commits de repos diferentes.
