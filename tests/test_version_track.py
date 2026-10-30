"""Single version track: package.json, portal_core and vendor manifest
must never diverge (Cycle 12 — the 0.1.0/1.0.0 split was review drift).
"""
import json
import sys
from pathlib import Path

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
