"""Single version track: package.json, portal_core, the CLI and the
vendor manifest must never diverge (Cycle 12 — the 0.1.0/1.0.0 split
was review drift; wave 15 — the CLI literal drifted a release behind).
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "portal_core"))

import forge_portal


def test_package_json_matches_portal_version():
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == forge_portal.PORTAL_VERSION


def test_vendor_uses_canonical_version():
    sys.path.insert(0, str(ROOT / "scripts"))
    import vendor

    assert vendor.PORTAL_VERSION == forge_portal.PORTAL_VERSION


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_cli_reports_package_version():
    """`forge-portal --json status` must report package.json's version —
    the CLI derives VERSION from package.json at runtime; a literal here
    is what drifted to 1.1.1 while the track moved to 1.1.3."""
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    out = subprocess.run(
        ["node", str(ROOT / "tools" / "portal-cli.mjs"), "--json", "status"],
        capture_output=True, text=True, timeout=30, check=False,
    )
    assert out.returncode == 0, out.stderr[-300:]
    payload = json.loads(out.stdout)
    assert payload["version"] == pkg["version"] == forge_portal.PORTAL_VERSION
