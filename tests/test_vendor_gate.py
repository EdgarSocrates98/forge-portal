"""Wave 15 — vendor.py gate honesty (§: soft-pass fix).

`vendor.py --check` used to exit 0 trivially when sibling checkouts were
absent — a silent pass that proved nothing. The gate now reports
"checked N of M" plus NOT_APPLICABLE skips, and `--require-all` fails
(exit 3) when a destination is missing. Atlas is a per-destination
opt-in module (adapters mount `atlas_operations()` explicitly), encoded
in FORGES via `modules`.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import vendor


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    """Fake workspace: FORGES + WORKSPACE + no dist build (assets skip)."""
    monkeypatch.setattr(vendor, "WORKSPACE", tmp_path)
    monkeypatch.setattr(vendor, "ASSETS_SRC", tmp_path / "no-dist")
    forges = {
        "atlas-forge": {"pkg": "pkg_atlas", "modules": "telemetry,atlas"},
        "plain-forge": "pkg_plain",
        "ghost-forge": "pkg_ghost",
    }
    monkeypatch.setattr(vendor, "FORGES", forges)
    return tmp_path, forges


def _seed(ws_path: Path, repo: str, pkg: str, *, server: bool = True,
          telemetry: bool = True, atlas: bool = False) -> Path:
    dest = ws_path / repo / pkg
    dest.mkdir(parents=True)
    target = vendor.FORGES[repo]
    if isinstance(target, str):
        target = {"pkg": target}
    if server:
        shutil.copyfile(vendor.SERVER_SRC, dest / "_forge_portal.py")
    if telemetry:
        (dest / "_portal_telemetry.py").write_bytes(vendor.telemetry_source(target))
    if atlas:
        (dest / "_portal_atlas.py").write_bytes(vendor.atlas_source(target))
    return dest


def test_atlas_absent_is_drift_only_where_opted_in(ws) -> None:
    ws_path, _ = ws
    _seed(ws_path, "atlas-forge", "pkg_atlas")          # atlas missing → drift
    _seed(ws_path, "plain-forge", "pkg_plain")          # telemetry-only → ok
    notes_a = vendor.vendor_one("atlas-forge", vendor.FORGES["atlas-forge"], check=True)
    notes_b = vendor.vendor_one("plain-forge", vendor.FORGES["plain-forge"], check=True)
    assert any(n.startswith("DRIFT") for n in notes_a), notes_a
    assert not any(n.startswith("DRIFT") for n in notes_b), notes_b
    assert not any("_portal_atlas" in n for n in notes_b)


def test_atlas_vendored_only_where_opted_in(ws) -> None:
    ws_path, _ = ws
    _seed(ws_path, "atlas-forge", "pkg_atlas")
    _seed(ws_path, "plain-forge", "pkg_plain")
    vendor.vendor_one("atlas-forge", vendor.FORGES["atlas-forge"], check=False)
    vendor.vendor_one("plain-forge", vendor.FORGES["plain-forge"], check=False)
    assert (ws_path / "atlas-forge" / "pkg_atlas" / "_portal_atlas.py").is_file()
    assert not (ws_path / "plain-forge" / "pkg_plain" / "_portal_atlas.py").exists()


def _run_main(monkeypatch, *argv: str) -> int:
    monkeypatch.setattr(sys, "argv", ["vendor.py", *argv])
    return vendor.main()


def test_check_summary_reports_checked_of_total(ws, capsys, monkeypatch) -> None:
    ws_path, _ = ws
    _seed(ws_path, "atlas-forge", "pkg_atlas", atlas=True)
    _seed(ws_path, "plain-forge", "pkg_plain")
    # ghost-forge checkout absent → NOT_APPLICABLE, honest summary
    code = _run_main(monkeypatch, "--check")
    out = capsys.readouterr().out
    assert "SKIP ghost-forge" in out
    assert "checked 2 of 3 destination(s)" in out
    assert "1 NOT_APPLICABLE" in out
    assert code == 0  # no drift among the checked destinations


def test_check_fails_on_real_drift(ws, capsys, monkeypatch) -> None:
    ws_path, _ = ws
    _seed(ws_path, "atlas-forge", "pkg_atlas")  # atlas missing = drift
    _seed(ws_path, "plain-forge", "pkg_plain")
    code = _run_main(monkeypatch, "--check")
    assert code == 1
    assert "DRIFT atlas-forge" in capsys.readouterr().out


def test_require_all_fails_when_a_checkout_is_absent(ws, monkeypatch) -> None:
    ws_path, _ = ws
    _seed(ws_path, "atlas-forge", "pkg_atlas", atlas=True)
    _seed(ws_path, "plain-forge", "pkg_plain")
    assert _run_main(monkeypatch, "--check", "--require-all") == 3


def test_require_all_passes_when_everything_present(ws, monkeypatch, capsys) -> None:
    ws_path, _ = ws
    _seed(ws_path, "atlas-forge", "pkg_atlas", atlas=True)
    _seed(ws_path, "plain-forge", "pkg_plain")
    _seed(ws_path, "ghost-forge", "pkg_ghost")
    assert _run_main(monkeypatch, "--check", "--require-all") == 0
    assert "checked 3 of 3" in capsys.readouterr().out
