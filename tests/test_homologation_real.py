"""Cycle 4 — the real per-forge homologation harness.

Two layers:

- **fast unit tests** over the status aggregator, discovery fallbacks
  and the JSON/Markdown report shapes (in-memory Probe objects — they
  test the *machinery*, they are not homologation evidence);
- **the live layer**: ``run_forge`` boots every locally-present real
  adapter subprocess and exercises the forge/PortalApi/1 surface over
  real HTTP. Every forge row is asserted against the closed status
  vocabulary and the evidence rule — ``VERIFIED`` without an evidence
  pointer fails. Absent forges are asserted to be ``NOT_TESTED``,
  never silently skipped.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "homologation.py"
SPEC = importlib.util.spec_from_file_location("homologation", SCRIPT)
assert SPEC and SPEC.loader
hom = importlib.util.module_from_spec(SPEC)
sys.modules.setdefault("homologation", hom)
SPEC.loader.exec_module(hom)

Probe = hom.Probe


# ---------------------------------------------------------------------------
# status aggregation — the honest-state algebra
# ---------------------------------------------------------------------------


def test_agg_empty_is_not_tested() -> None:
    status, detail, evidence = hom._agg([])
    assert status == "NOT_TESTED"
    assert evidence == []
    assert "no probes" in detail


def test_agg_single_status_sets_pass_through() -> None:
    for s in ("NOT_APPLICABLE", "UNSUPPORTED", "BLOCKED", "NOT_TESTED"):
        status, _, _ = hom._agg([Probe(s, "d", "e"), Probe(s, "d2", "e2")])
        assert status == s, s


def test_agg_verified_with_absent_capabilities_stays_verified() -> None:
    status, _, evidence = hom._agg([
        Probe("VERIFIED", "op answered", "GET /x → 200"),
        Probe("NOT_APPLICABLE", "not claimed", "GET /y → 404"),
        Probe("NOT_TESTED", "policy", "—"),
    ])
    assert status == "VERIFIED"
    assert len(evidence) == 3


def test_agg_any_failure_marks_partial() -> None:
    status, _, _ = hom._agg([
        Probe("VERIFIED", "ok", "e"),
        Probe("PARTIAL", "declared supported but op absent", "cap vs 404"),
    ])
    assert status == "PARTIAL"
    status, _, _ = hom._agg([Probe("VERIFIED", "ok", "e"), Probe("BLOCKED", "b", "e")])
    assert status == "PARTIAL"


def test_agg_verified_only_is_verified() -> None:
    status, _, _ = hom._agg([Probe("VERIFIED", "a", "e"), Probe("VERIFIED", "b", "e")])
    assert status == "VERIFIED"


# ---------------------------------------------------------------------------
# error/request helpers
# ---------------------------------------------------------------------------


def test_err_code_and_data_extract_envelope_fields() -> None:
    body = {"error": {"code": "PORTAL-CONFIRM", "message": "confirm required"},
            "data": {"state": "INSTALLED"}}
    assert hom._err_code(body) == "PORTAL-CONFIRM"
    assert hom._data(body) == {"state": "INSTALLED"}
    assert hom._err_code({}) == ""
    assert hom._err_code({"error": "string"}) == ""
    assert hom._data({}) is None


# ---------------------------------------------------------------------------
# discovery — real lookup semantics, honest absence
# ---------------------------------------------------------------------------


def test_discover_absent_forge_is_honestly_not_present(tmp_path, monkeypatch) -> None:
    """A forge with no manifest/checkout/venv → present=False — never
    a fabricated row. Point discovery at empty roots and prove it."""
    monkeypatch.setenv("FORGE_HOME_OVERRIDE", str(tmp_path))
    monkeypatch.setenv("FORGE_ECOSYSTEM", str(tmp_path / "eco"))
    spec = hom.ForgeSpec("ghost-forge", "ghost-forge", ("-m", "ghost.portal_adapter"), "ghost")
    local = hom.discover(spec)
    assert local.present is False
    assert local.checkout is None
    assert local.installed_python is None
    assert local.manifest_path is None


def test_discover_prefers_bootable_checkout(tmp_path, monkeypatch) -> None:
    """A stale manifest-declared checkout (no .venv) must not win over
    an ecosystem candidate that actually has a python — the bug that
    hid forge-doctor-api's boot during cycle 4."""
    stale = tmp_path / "stale" / "fake-forge"
    stale.mkdir(parents=True)                      # exists but no .venv
    real = tmp_path / "eco" / "fake-forge"
    (real / ".venv" / "bin").mkdir(parents=True)
    (real / ".venv" / "bin" / "python").write_text("#!/bin/sh\n")
    monkeypatch.setenv("FORGE_HOME_OVERRIDE", str(tmp_path / "home"))
    (tmp_path / "home" / ".forge" / "installations").mkdir(parents=True)
    monkeypatch.setenv("FORGE_ECOSYSTEM", str(tmp_path / "eco"))
    found = hom._find_checkout("fake-forge", {"path": str(stale)})
    assert found == real


def test_report_shape_and_markdown() -> None:
    """build_report + matrix_markdown on an in-memory result: schema,
    summary over the closed vocabulary, and a row per capability."""
    spec = hom.FORGES[0]
    local = hom.ForgeLocal(spec=spec, manifest_path=None, manifest=None,
                           checkout=None, dev_python=None,
                           installed_python=None, install_root=None)
    caps = {cap: {"status": "VERIFIED", "detail": "d", "evidence": ["e"]}
            for cap in hom.CAPABILITY_ORDER}
    caps["mutations"] = {"status": "NOT_TESTED", "detail": "policy", "evidence": []}
    r = hom.ForgeResult(spec=spec, local=local, present=True, booted=True,
                        url="http://127.0.0.1:1/?forge_session=x",
                        boot_error=None, capabilities=caps)
    report = hom.build_report([r])
    assert report["schema"] == hom.SCHEMA
    assert report["summary"]["VERIFIED"] == len(hom.CAPABILITY_ORDER) - 1
    assert report["summary"]["NOT_TESTED"] == 1
    md = hom.matrix_markdown(report)
    assert "| Capability |" in md and spec.forge_id in md
    assert "VERIFIED" in md and "NOT_TESTED" in md


# ---------------------------------------------------------------------------
# checked-in evidence — docs/homologation/cycle-4-matrix.json must be a
# real, internally-consistent artifact whenever it exists
# ---------------------------------------------------------------------------


def test_checked_in_matrix_is_consistent() -> None:
    art = REPO / "docs" / "homologation" / "cycle-4-matrix.json"
    if not art.is_file():
        pytest.skip("matrix artifact not generated — run scripts/homologation.py --write")
    report = json.loads(art.read_text(encoding="utf-8"))
    assert report["schema"] == hom.SCHEMA
    counts = {s: 0 for s in hom.STATUSES}
    for f in report["forges"]:
        assert set(f["capabilities"]) == set(hom.CAPABILITY_ORDER)
        for cap, c in f["capabilities"].items():
            assert c["status"] in hom.STATUSES, f"{f['forge_id']}.{cap}: {c['status']}"
            counts[c["status"]] += 1
            if c["status"] == "VERIFIED":
                assert c["evidence"], (
                    f"{f['forge_id']}.{cap} VERIFIED without evidence pointer"
                )
        if f["booted"]:
            assert f["url"] and f["url"].startswith("http://127.0.0.1:")
            assert f["capabilities"]["initialization"]["status"] == "VERIFIED"
            assert f["capabilities"]["mutations"]["status"] == "NOT_TESTED"
    assert report["summary"] == counts


# ---------------------------------------------------------------------------
# live layer — boot every locally-present adapter, assert honest rows
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def live_matrix():
    """Run the real matrix once for the module; rows keyed by forge_id."""
    results = {}
    for spec in hom.FORGES:
        try:
            results[spec.forge_id] = hom.run_forge(spec)
        except Exception as e:  # noqa: BLE001 — record, never fake
            local = hom.discover(spec)
            caps = {cap: {"status": "NOT_TESTED",
                          "detail": f"harness error: {e}", "evidence": [str(e)]}
                    for cap in hom.CAPABILITY_ORDER}
            caps["initialization"] = {"status": "PARTIAL",
                                      "detail": f"harness error: {e}",
                                      "evidence": [str(e)]}
            results[spec.forge_id] = hom.ForgeResult(
                spec=spec, local=local, present=local.present,
                booted=False, url=None, boot_error=str(e), capabilities=caps)
    return results


@pytest.mark.parametrize("spec", hom.FORGES, ids=lambda s: s.forge_id)
def test_forge_row_is_complete_and_honest(live_matrix, spec) -> None:
    r = live_matrix[spec.forge_id]
    assert set(r.capabilities) == set(hom.CAPABILITY_ORDER)
    for cap, c in r.capabilities.items():
        assert c["status"] in hom.STATUSES, f"{cap}: invented status {c['status']}"
        if c["status"] == "VERIFIED":
            assert c["evidence"], f"{cap} VERIFIED without evidence pointer"


@pytest.mark.parametrize("spec", hom.FORGES, ids=lambda s: s.forge_id)
def test_present_forge_boots_and_probes(live_matrix, spec) -> None:
    """A forge that IS on this machine must boot its real adapter and
    answer the surface; a PARTIAL/BLOCKED row on a booted forge is a
    real integration regression, not a skipped test."""
    r = live_matrix[spec.forge_id]
    if not r.present:
        assert all(c["status"] == "NOT_TESTED" for c in r.capabilities.values())
        pytest.skip(f"{spec.forge_id} not installed locally — row is NOT_TESTED")
    assert r.booted, f"{spec.forge_id} present but adapter did not boot: {r.boot_error}"
    assert r.capabilities["initialization"]["status"] == "VERIFIED"
    # mutations are intentionally never executed — the refusal boundary
    # is what gets verified under error_paths
    assert r.capabilities["mutations"]["status"] == "NOT_TESTED"
    assert r.capabilities["error_paths"]["status"] == "VERIFIED"
    assert r.capabilities["unavailable"]["status"] == "VERIFIED"
    bad = {cap: c["status"] for cap, c in r.capabilities.items()
           if c["status"] in ("PARTIAL", "BLOCKED")}
    assert not bad, f"{spec.forge_id} unexplained gaps: {bad}"


def test_summary_has_no_unexplained_gaps(live_matrix) -> None:
    """Cross-forge: a booted forge with a PARTIAL row gates the run —
    the same rule the CLI exit code encodes."""
    bad = []
    for r in live_matrix.values():
        if not r.booted:
            continue
        bad += [f"{r.spec.forge_id}.{cap}={c['status']}"
                for cap, c in r.capabilities.items()
                if c["status"] in ("PARTIAL", "BLOCKED")]
    assert not bad, "unexplained homologation gaps: " + ", ".join(bad)


def test_the_forge_federated_surface_when_present(live_matrix) -> None:
    """The federated control plane: federation/versions/lab are real on
    the-forge and honestly NOT_APPLICABLE everywhere else."""
    r = live_matrix["the-forge"]
    if not r.present:
        pytest.skip("the-forge not installed locally")
    assert r.booted
    for cap in ("federation", "versions", "lab"):
        assert r.capabilities[cap]["status"] == "VERIFIED", (
            f"the-forge.{cap}: {r.capabilities[cap]['detail']}"
        )
    for fid, other in live_matrix.items():
        if fid == "the-forge" or not other.booted:
            continue
        assert other.capabilities["federation"]["status"] == "NOT_APPLICABLE", (
            f"{fid} answered federation without claiming it"
        )
