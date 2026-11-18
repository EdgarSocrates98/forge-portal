"""Wave 15 — workspace member detection + resource provenance fields
(§20.1 Workspace Control Center / §20.3 Resource Explorer).

`workspace_resources` scans `<root>/*/forge.agentic.json` at depth 1
(manifest-holders) and, since this wave, detects member repositories by
marker — `.git` or a project manifest — so gitless members surface too
(same vocabulary as the installkit MEMBER_MARKERS). Detection is
depth-bounded, never follows symlinks/junctions, skips hidden and
tool-cache dirs, and never descends into a discovered member.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "portal_core"))

import forge_portal as fp


def _manifest(dirpath: Path, **extra) -> None:
    dirpath.mkdir(parents=True, exist_ok=True)
    doc = {
        "schema": "forge/SpecialistAgenticManifest/v1",
        "provider": dirpath.name,
        "version": "9.9.9",
        "host_adapters": ["claude", "devin"],
        "skills": ["legacy-skill"],
        "resources": [
            {
                "id": "typed-skill",
                "kind": "skill",
                "location": "skills/typed/SKILL.md",
                "resource_class": "agentic",
            }
        ],
        **extra,
    }
    (dirpath / "forge.agentic.json").write_text(
        json.dumps(doc), encoding="utf-8"
    )


def test_gitless_members_surface_alongside_manifest_holders(tmp_path) -> None:
    """A dir with only pyproject.toml or package.json is a member even
    without .git or forge.agentic.json — the §20.1 'gitless members'
    requirement."""
    (tmp_path / "forge-a").mkdir()
    _manifest(tmp_path / "forge-a")
    (tmp_path / "py-lib").mkdir()
    (tmp_path / "py-lib" / "pyproject.toml").write_text("[project]\n")
    (tmp_path / "node-app").mkdir()
    (tmp_path / "node-app" / "package.json").write_text("{}\n")
    (tmp_path / "empty-dir").mkdir()

    out = fp.workspace_resources(str(tmp_path))
    members = {m["name"]: m for m in out["members"]}
    assert set(members) == {"forge-a", "py-lib", "node-app"}
    assert members["forge-a"]["manifest"] is True
    assert members["py-lib"]["markers"] == ["pyproject.toml"]
    assert members["py-lib"]["git"] is False
    assert members["node-app"]["git"] is False


def test_git_marker_counts_as_member(tmp_path) -> None:
    (tmp_path / "repo").mkdir()
    (tmp_path / "repo" / ".git").mkdir()
    out = fp.workspace_resources(str(tmp_path))
    assert out["members"][0]["git"] is True


def test_member_walk_never_descends_into_a_member(tmp_path) -> None:
    """A member's nested dirs stay isolated — nested manifests inside a
    discovered member do not produce extra members."""
    (tmp_path / "mono").mkdir()
    (tmp_path / "mono" / "pyproject.toml").write_text("[project]\n")
    nested = tmp_path / "mono" / "libs" / "inner"
    nested.mkdir(parents=True)
    (nested / "package.json").write_text("{}\n")
    out = fp.workspace_resources(str(tmp_path))
    assert [m["name"] for m in out["members"]] == ["mono"]


def test_member_depth_is_bounded(tmp_path) -> None:
    """Markers deeper than _MEMBER_MAX_DEPTH under a non-member chain do
    not surface — the walk is bounded, not recursive."""
    deep = tmp_path / "a" / "b" / "c"
    deep.mkdir(parents=True)
    (deep / "pyproject.toml").write_text("[project]\n")
    out = fp.workspace_resources(str(tmp_path))
    assert out["members"] == []


def test_member_walk_skips_hidden_and_tool_dirs(tmp_path) -> None:
    for name in (".hidden", "node_modules", ".venv", "dist", "__pycache__"):
        d = tmp_path / name
        d.mkdir()
        (d / "pyproject.toml").write_text("[project]\n")
    out = fp.workspace_resources(str(tmp_path))
    assert out["members"] == []


@pytest.mark.skipif(os.name == "nt", reason="symlink creation needs privilege on Windows")
def test_member_walk_never_follows_symlinks(tmp_path) -> None:
    real = tmp_path / "outside"
    real.mkdir()
    (real / "pyproject.toml").write_text("[project]\n")
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "linked").symlink_to(real, target_is_directory=True)
    out = fp.workspace_resources(str(ws))
    assert out["members"] == []


def test_root_itself_counts_when_marked(tmp_path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\n")
    out = fp.workspace_resources(str(tmp_path))
    assert out["members"][0]["path"] == "."


def test_manifest_holders_still_drive_forge_catalog(tmp_path) -> None:
    _manifest(tmp_path / "forge-a", version="1.2.3")
    out = fp.workspace_resources(str(tmp_path))
    assert out["forges"] == ["forge-a"]
    # legacy skills[] promoted to conditional placeholder (Onda 10 rule)
    legacy = next(r for r in out["resources"] if r["id"] == "legacy-skill")
    assert legacy["availability"] == "conditional"
    assert legacy["version"] == "1.2.3"
    assert legacy["hosts"] == ["claude", "devin"]
    typed = next(r for r in out["resources"] if r["id"] == "typed-skill")
    assert typed["version"] == "1.2.3"
    assert typed["hosts"] == ["claude", "devin"]
    # undeclared provenance stays None — never invented
    assert typed["domain"] is None
    assert typed["hash"] is None
    assert typed["integrity"] is None


def test_entry_level_overrides_win_over_manifest(tmp_path) -> None:
    _manifest(
        tmp_path / "forge-b",
        version="2.0.0",
        resources=[
            {
                "id": "pinned",
                "kind": "skill",
                "location": "s/SKILL.md",
                "version": "3.1.4",
                "domain": "analytics",
                "hosts": ["claude"],
                "hash": "sha256:abc",
                "integrity": "verified",
            }
        ],
    )
    out = fp.workspace_resources(str(tmp_path))
    (e,) = [r for r in out["resources"] if r["id"] == "pinned"]
    assert e["version"] == "3.1.4"
    assert e["domain"] == "analytics"
    assert e["hosts"] == ["claude"]
    assert e["hash"] == "sha256:abc"
    assert e["integrity"] == "verified"


def test_missing_root_and_none_stay_honest(tmp_path) -> None:
    out = fp.workspace_resources(None)
    assert out == {
        "workspace": None,
        "forges": [],
        "members": [],
        "resources": [],
        "errors": [],
    }
    out = fp.workspace_resources(str(tmp_path / "nope"))
    assert out["members"] == []
    assert out["errors"] and "not found" in out["errors"][0]
