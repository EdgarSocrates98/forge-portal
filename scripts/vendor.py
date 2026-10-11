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
ASSETS_SRC = ROOT / "dist" / "forge-portal-app" / "browser"
PORTAL_VERSION = "1.0.0"

# sibling repo → package dir that receives _forge_portal.py
FORGES: dict[str, str] = {
    "the-forge": "src/theforge",
    "spark-forge-aws": "sparkforge",
    "spark-forge-azure": "sparkforge_azure",
    "api-forge": "src/apiforge",
    "platform-forge": "platformforge",
    "forge-doctor-data": "src/forge_doctor_data",
    "forge-doctor-api": "src/forge_doctor_api",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest_for(assets_dir: Path) -> dict:
    files = {}
    for p in sorted(assets_dir.rglob("*")):
        if p.is_file():
            rel = p.relative_to(assets_dir).as_posix()
            files[rel] = {"sha256": sha256(p), "bytes": p.stat().st_size}
    return {"schema": "forge/PortalAssets/1", "portal_version": PORTAL_VERSION, "files": files}


def vendor_one(name: str, pkg: str, *, check: bool) -> list[str]:
    repo = WORKSPACE / name
    notes: list[str] = []
    if not repo.is_dir():
        return [f"SKIP {name}: checkout not found at {repo}"]

    server_dst = repo / pkg / "_forge_portal.py"
    assets_dst = repo / "portal" / "assets"
    manifest_dst = repo / "portal" / "manifest.json"

    diffs: list[Path] = []
    if server_dst.is_file() and sha256(server_dst) == sha256(SERVER_SRC):
        notes.append(f"  server: byte-parity ok ({server_dst.name})")
    else:
        diffs.append(server_dst)

    if ASSETS_SRC.is_dir():
        new_manifest = manifest_for(ASSETS_SRC)
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

    if ASSETS_SRC.is_dir():
        if assets_dst.is_dir():
            shutil.rmtree(assets_dst)
        shutil.copytree(ASSETS_SRC, assets_dst)
        manifest_dst.parent.mkdir(parents=True, exist_ok=True)
        manifest_dst.write_text(
            json.dumps(manifest_for(assets_dst), indent=2, sort_keys=True) + "\n",
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
