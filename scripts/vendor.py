#!/usr/bin/env python3
# vendor.py — propagate the portal server + built assets to sibling forges.
#
# What it does, why, when:
#   - copies `portal_core/forge_portal.py` → `<repo>/src/<pkg>/_forge_portal.py`
#     (byte-parity vendored module, like `_installkit.py`/`_graphstudio.py`)
#   - copies `dist/forge-portal-app/browser/*` → `<repo>/portal/assets/`
#   - writes `<repo>/portal/manifest.json` with sha256 + size per file and
#     the portal version — the forge's `<cli> portal` verifies assets
#     against this manifest before serving (tamper/drift detection)
#
# Usage:  python scripts/vendor.py [--repo NAME] [--check]
#   --repo NAME   vendor a single forge (default: all known siblings)
#   --check       verify byte-parity without writing (drift gate)
#   Requires: `npm run build` first (assets must exist).

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent
SERVER_SRC = ROOT / "portal_core" / "forge_portal.py"
TELEMETRY_SRC = ROOT / "portal_core" / "telemetry.py"
ATLAS_SRC = ROOT / "portal_core" / "atlas_ops.py"
ASSETS_SRC = ROOT / "dist" / "forge-portal-app" / "browser"
# Única fonte de verdade da versão do portal — portal_core/forge_portal.py
# (vendored verbatim para dentro dos pacotes; package.json é validado
# contra ela por teste para não abrir trilha dupla de novo).
sys.path.insert(0, str(ROOT / "portal_core"))
from forge_portal import PORTAL_VERSION

# sibling repo → package dir that receives _forge_portal.py
FORGES: dict[str, str | dict[str, str]] = {
    "the-forge": "src/theforge",
    "spark-forge-aws": "sparkforge_aws",
    "spark-forge-azure": "sparkforge_azure",
    "api-forge": "src/apiforge",
    "platform-forge": "platformforge",
    # doctor-data is poetry-packaged: only files inside the package dir
    # ship in the wheel, so assets live in the package (portal_assets).
    "forge-doctor-data": {
        "pkg": "src/forge_doctor_data",
        "assets": "src/forge_doctor_data/portal_assets",
        "manifest": "portal/manifest.json",
    },
    # doctor-api package boundary bans network imports in src/ — the portal
    # is a checkout-level host surface like forge_install.py → scripts/.
    # "flat": modules in that dir import siblings by bare module name.
    "forge-doctor-api": {"pkg": "scripts", "flat": "1"},
    # product-forge: assets only.  Its `_forge_portal.py` is synced by the
    # specialist's own byte-parity gate, and the bundle manifest uses the
    # product-specific `forge/ProductForgePortalManifest/v1` schema that
    # `portal/runtime._assets_dir()` validates at startup.
    "product-forge": {
        "pkg": "src/product_forge",
        "assets_only": "1",
        "assets": "src/product_forge/portal_assets/angular/browser",
        "manifest": "src/product_forge/portal_assets/angular/browser/manifest.json",
    },
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest_for(
    assets_dir: Path,
    server_path: Path = SERVER_SRC,
    telemetry_hash: str | None = None,
    extra_hashes: dict[str, str] | None = None,
) -> dict:
    files = {}
    for p in sorted(assets_dir.rglob("*")):
        if p.is_file():
            rel = p.relative_to(assets_dir).as_posix()
            files[rel] = {"sha256": sha256(p), "bytes": p.stat().st_size}
    server_hash = sha256(server_path)
    manifest = {
        "schema": "forge/PortalAssets/1",
        "portal_version": PORTAL_VERSION,
        "server_generation": server_hash[:16],
        "server_sha256": server_hash,
        "files": files,
    }
    if telemetry_hash is not None:
        manifest["telemetry_generation"] = telemetry_hash[:16]
        manifest["telemetry_sha256"] = telemetry_hash
    for key, h in sorted((extra_hashes or {}).items()):
        manifest[f"{key}_generation"] = h[:16]
        manifest[f"{key}_sha256"] = h
    return manifest


def pf_manifest(assets_dir: Path, previous: dict) -> dict:
    """Product Forge portal manifest — `forge/ProductForgePortalManifest/v1`.
    Fields the specialist owns (product_forge_version, contracts, integrity)
    are preserved from the previous manifest; the portal fields are refreshed
    from this build."""
    files = {
        p.relative_to(assets_dir).as_posix(): sha256(p)
        for p in sorted(assets_dir.rglob("*"))
        if p.is_file() and p.name != "manifest.json"
    }
    fingerprint = hashlib.sha256(
        json.dumps(files, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    manifest = dict(previous)
    manifest.update(
        {
            "schema": "forge/ProductForgePortalManifest/v1",
            "portal_version": PORTAL_VERSION,
            "portal_commit": fingerprint,
            "build_mode": "production",
        }
    )
    manifest.setdefault("product_forge_version", "0.1.0")
    manifest.setdefault("angular_version", "")
    manifest.setdefault("api_schema", "forge/PortalApi/1")
    manifest.setdefault("bridge_contract", "forge/AgentBridge/1")
    manifest.setdefault("integrity", "verified-by-package-build")
    return manifest


def _module_source(src: Path, target: dict[str, str]) -> bytes:
    """Vendored satellite-module content for a target. Canonical modules
    do `import forge_portal as fp` (portal_core flat layout); vendored
    copies must reference the vendored `_forge_portal` instead — package
    targets use `from <pkg> import _forge_portal`, flat dirs (scripts/)
    use `import _forge_portal`."""
    text = src.read_text(encoding="utf-8")
    if target.get("flat"):
        line = "import _forge_portal as fp"
    else:
        pkg = Path(target["pkg"]).name
        line = f"from {pkg} import _forge_portal as fp"
    return text.replace("import forge_portal as fp", line, 1).encode("utf-8")


def telemetry_source(target: dict[str, str]) -> bytes:
    """`_portal_telemetry.py` content for a target (see _module_source)."""
    return _module_source(TELEMETRY_SRC, target)


def atlas_source(target: dict[str, str]) -> bytes:
    """`_portal_atlas.py` content for a target (see _module_source)."""
    return _module_source(ATLAS_SRC, target)


def vendor_one(name: str, target: str | dict[str, str], *, check: bool) -> list[str]:
    repo = WORKSPACE / name
    notes: list[str] = []
    if not repo.is_dir():
        return [f"SKIP {name}: checkout not found at {repo}"]

    if isinstance(target, str):
        target = {"pkg": target}

    assets_dst = repo / target.get("assets", "portal/assets")
    manifest_dst = repo / target.get("manifest", "portal/manifest.json")

    if target.get("assets_only"):
        # Assets + specialist manifest only; `_forge_portal.py` parity is
        # owned by the target repo, never overwritten here.
        if not ASSETS_SRC.is_dir():
            return ["  assets: dist build missing — run `npm run build` first"]
        old_manifest = {}
        if manifest_dst.is_file():
            try:
                old_manifest = json.loads(manifest_dst.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                old_manifest = {}
        new_manifest = pf_manifest(ASSETS_SRC, old_manifest)
        stale_files = not assets_dst.is_dir() or {
            p.relative_to(assets_dst).as_posix()
            for p in assets_dst.rglob("*")
            if p.is_file() and p.name != "manifest.json"
        } != {
            p.relative_to(ASSETS_SRC).as_posix()
            for p in ASSETS_SRC.rglob("*")
            if p.is_file()
        }
        stale_hash = not stale_files and any(
            sha256(p) != sha256(assets_dst / p.relative_to(ASSETS_SRC))
            for p in ASSETS_SRC.rglob("*")
            if p.is_file()
        )
        if check:
            if stale_files or stale_hash or old_manifest != new_manifest:
                notes.append(f"DRIFT {name}: portal assets out of parity")
            else:
                notes.append("  assets: parity ok")
            return notes
        if assets_dst.is_dir():
            shutil.rmtree(assets_dst)
        shutil.copytree(ASSETS_SRC, assets_dst)
        manifest_dst.write_text(
            json.dumps(new_manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        notes.append(
            f"  wrote {assets_dst.relative_to(repo)}/ + manifest.json"
            f" ({len(new_manifest)} fields, assets fingerprint {new_manifest['portal_commit']})"
        )
        return notes

    server_dst = repo / target["pkg"] / "_forge_portal.py"
    telemetry_dst = repo / target["pkg"] / "_portal_telemetry.py"
    atlas_dst = repo / target["pkg"] / "_portal_atlas.py"

    telemetry_bytes = telemetry_source(target) if TELEMETRY_SRC.is_file() else None
    telemetry_hash = (
        hashlib.sha256(telemetry_bytes).hexdigest() if telemetry_bytes else None
    )
    atlas_bytes = atlas_source(target) if ATLAS_SRC.is_file() else None
    atlas_hash = hashlib.sha256(atlas_bytes).hexdigest() if atlas_bytes else None
    extra_hashes = {"atlas": atlas_hash} if atlas_hash else None

    diffs: list[Path] = []
    if server_dst.is_file() and sha256(server_dst) == sha256(SERVER_SRC):
        notes.append(f"  server: byte-parity ok ({server_dst.name})")
    else:
        diffs.append(server_dst)

    if telemetry_bytes is not None:
        if telemetry_dst.is_file() and telemetry_dst.read_bytes() == telemetry_bytes:
            notes.append(f"  telemetry: parity ok ({telemetry_dst.name})")
        else:
            diffs.append(telemetry_dst)

    if atlas_bytes is not None:
        if atlas_dst.is_file() and atlas_dst.read_bytes() == atlas_bytes:
            notes.append(f"  atlas: parity ok ({atlas_dst.name})")
        else:
            diffs.append(atlas_dst)

    if ASSETS_SRC.is_dir():
        new_manifest = manifest_for(
            ASSETS_SRC, telemetry_hash=telemetry_hash, extra_hashes=extra_hashes
        )
        old_manifest = {}
        if manifest_dst.is_file():
            try:
                old_manifest = json.loads(manifest_dst.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                old_manifest = {}
        if old_manifest == new_manifest and assets_dst.is_dir():
            notes.append(f"  assets: manifest unchanged ({len(new_manifest['files'])} files)")
        else:
            diffs.append(assets_dst)
    else:
        notes.append("  assets: dist build missing — run `npm run build` first")

    if check:
        if diffs:
            notes.append(f"DRIFT {name}: {len(diffs)} target(s) out of parity")
        return notes

    server_dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SERVER_SRC, server_dst)
    notes.append(f"  wrote {server_dst.relative_to(repo)}")

    if telemetry_bytes is not None:
        telemetry_dst.write_bytes(telemetry_bytes)
        notes.append(f"  wrote {telemetry_dst.relative_to(repo)}")

    if atlas_bytes is not None:
        atlas_dst.write_bytes(atlas_bytes)
        notes.append(f"  wrote {atlas_dst.relative_to(repo)}")

    if ASSETS_SRC.is_dir():
        if assets_dst.is_dir():
            shutil.rmtree(assets_dst)
        shutil.copytree(ASSETS_SRC, assets_dst)
        manifest_dst.parent.mkdir(parents=True, exist_ok=True)
        manifest_dst.write_text(
            json.dumps(
                manifest_for(
                    assets_dst,
                    server_dst,
                    telemetry_hash=telemetry_hash,
                    extra_hashes=extra_hashes,
                ),
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        notes.append(f"  wrote {assets_dst.relative_to(repo)}/ + manifest.json")
    return notes


def main() -> int:
    ap = argparse.ArgumentParser(description="Vendor forge_portal + assets to sibling forges")
    ap.add_argument("--repo", choices=sorted(FORGES), help="vendor a single forge")
    ap.add_argument("--check", action="store_true", help="verify parity without writing")
    args = ap.parse_args()

    if not SERVER_SRC.is_file():
        print(f"error: {SERVER_SRC} not found", file=sys.stderr)
        return 2
    if not ASSETS_SRC.is_dir():
        print(f"warning: {ASSETS_SRC} missing — server still vendored, assets skipped", file=sys.stderr)

    targets = {args.repo: FORGES[args.repo]} if args.repo else FORGES
    drift = False
    for name, pkg in targets.items():
        print(f"{name}:")
        for line in vendor_one(name, pkg, check=args.check):
            print(line)
            if line.startswith("DRIFT"):
                drift = True
    return 1 if (args.check and drift) else 0


if __name__ == "__main__":
    raise SystemExit(main())
