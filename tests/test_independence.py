"""Cycle 4 — independence in both directions, checked for real.

The portal is *optional*: it must work with no forge CLI and no
sibling checkout; each forge's installed copy must import and its CLI
must answer with zero portal involvement. Adapters stay isolated —
``portal_core`` is stdlib-only and imports no forge package — and the
vendored ``_forge_portal.py`` copies are hashed, not trusted.

Nothing here installs, uninstalls or mutates — every check is a read,
an import probe or a ``--version`` subprocess.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PORTAL_CORE = REPO / "portal_core"
SCRIPT = REPO / "scripts" / "homologation.py"
SPEC = importlib.util.spec_from_file_location("homologation", SCRIPT)
assert SPEC and SPEC.loader
hom = importlib.util.module_from_spec(SPEC)
sys.modules.setdefault("homologation", hom)
SPEC.loader.exec_module(hom)

SIBLING_PACKAGES = {
    "theforge", "apiforge", "platformforge", "sparkforge_aws",
    "sparkforge_azure", "forge_doctor_data", "forge_doctor_api",
}

# Vendored copies are allowed exactly one generation of lag: when
# portal_core/forge_portal.py changes, sibling checkouts still carry the
# previous committed generation until each forge re-vendors on its own
# flow (scripts/vendor.py). A copy matching neither the current nor the
# immediately-previous generation is real drift and still fails.
# (Cycle 6: send_error hardening + X-Frame-Options/Permissions-Policy —
# copies at a968ad06… are the documented lag, not a defect.)
KNOWN_PREV_GENERATIONS = {
    "a968ad06ee4c6d683599657b09ee776482bc992e551755e9c27a7c3767809584",
}


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    mods: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module.split(".")[0])
    return mods


# ---------------------------------------------------------------------------
# portal_core is stdlib-only and forge-free (no new mandatory deps, no
# circular imports — a plain import under a clean interpreter works)
# ---------------------------------------------------------------------------


def test_portal_core_is_stdlib_only() -> None:
    stdlib = set(sys.stdlib_module_names)
    local = {p.stem for p in PORTAL_CORE.glob("*.py")}
    for py in sorted(PORTAL_CORE.glob("*.py")):
        foreign = _imports(py) - stdlib - local
        assert not foreign, f"{py.name} imports non-stdlib modules: {foreign}"


def test_portal_core_imports_no_sibling_forge() -> None:
    for py in sorted(PORTAL_CORE.glob("*.py")):
        leaked = _imports(py) & SIBLING_PACKAGES
        assert not leaked, f"{py.name} imports forge packages: {leaked}"


def test_portal_imports_clean_in_subprocess(tmp_path) -> None:
    """forge_portal + registry_ops + telemetry import under a bare
    interpreter with an empty home — no circular import, no ambient
    forge/CLI needed."""
    env = dict(os.environ, FORGE_CLI_HOME=str(tmp_path),
               FORGE_HOME_OVERRIDE=str(tmp_path))
    code = (
        "import sys; sys.path.insert(0, " + repr(str(PORTAL_CORE)) + ");"
        "import forge_portal, registry_ops, telemetry;"
        "print('ok')"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=tmp_path,
                         capture_output=True, text=True, env=env, timeout=60,
                         check=False)
    assert out.returncode == 0 and "ok" in out.stdout, out.stderr[-400:]


def test_portal_serves_without_any_forge(tmp_path) -> None:
    """The whole loopback server answers with zero sibling checkouts,
    an empty FORGE_CLI_HOME and an empty registry — bootstrap and
    registry/state return honest data, not crashes."""
    env = dict(os.environ, FORGE_CLI_HOME=str(tmp_path),
               FORGE_HOME_OVERRIDE=str(tmp_path))
    code = (
        "import sys, json, urllib.request;"
        f"sys.path.insert(0, {str(PORTAL_CORE)!r});"
        "import forge_portal as fp;"
        "adapter = fp.PortalAdapter();"
        "adapter.ops = fp.default_operations(adapter);"
        "server = fp.PortalServer(adapter, quiet=True);"
        "server.serve_in_thread();"
        "req = urllib.request.Request("
        "  server.url.replace('/?', '/api/v1/bootstrap?'),"
        "  headers={'X-Forge-Session': server.session_token});"
        "r = json.loads(urllib.request.urlopen(req, timeout=10).read());"
        "print(json.dumps({'schema': r['schema'], 'data': sorted(r['data'])}));"
        "server.shutdown()"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=tmp_path,
                         capture_output=True, text=True, env=env, timeout=60,
                         check=False)
    assert out.returncode == 0, out.stderr[-400:]
    doc = json.loads(out.stdout.strip().splitlines()[-1])
    assert doc["schema"] == "forge/PortalApi/1"


# ---------------------------------------------------------------------------
# forges work without the portal — installed copies import and CLIs
# answer --version with no portal module involved
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def discovered():
    return {s.forge_id: hom.discover(s) for s in hom.FORGES}


@pytest.mark.parametrize("spec", hom.FORGES, ids=lambda s: s.forge_id)
def test_installed_copy_imports_without_portal(discovered, spec) -> None:
    local = discovered[spec.forge_id]
    if local.installed_python is None:
        pytest.skip(f"{spec.forge_id} has no installed venv locally")
    # importing the package — NOT the adapter — must never pull in
    # portal machinery: the forge stands alone.
    out = subprocess.run(
        [str(local.installed_python), "-c",
         f"import {spec.package}; print('ok')"],
        capture_output=True, text=True, timeout=60, check=False,
        cwd=tempfile.gettempdir(),
    )
    assert out.returncode == 0 and "ok" in out.stdout, (
        f"{spec.package} import failed: {out.stderr[-300:]}"
    )


@pytest.mark.parametrize("spec", hom.FORGES, ids=lambda s: s.forge_id)
def test_cli_answers_without_portal(discovered, spec) -> None:
    local = discovered[spec.forge_id]
    if local.installed_python is None:
        pytest.skip(f"{spec.forge_id} has no installed venv locally")
    cli = local.installed_python.parent / (spec.cli or spec.forge_id)
    if not cli.is_file():
        pytest.skip(f"CLI binary {cli.name} absent in {spec.forge_id} venv")
    out = subprocess.run([str(cli), "--version"], capture_output=True,
                         text=True, timeout=60, check=False,
                         cwd=tempfile.gettempdir())
    assert out.returncode == 0 and out.stdout.strip(), (
        f"{cli.name} --version failed: {out.stderr[-200:]}"
    )


# ---------------------------------------------------------------------------
# vendoring integrity — every _forge_portal.py copy is hashed against
# portal_core; drift is allowed only where already documented
# ---------------------------------------------------------------------------


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


_VENDOR_SKIP = {".venv", "venv", "node_modules", ".git", "dist", "build",
                "__pycache__", ".tox", ".mypy_cache", ".pytest_cache"}


def _vendor_copies(root: Path):
    """Walk for vendored _forge_portal.py copies, pruning heavy dirs
    (.venv/node_modules/.git) — a plain rglob scans hundreds of
    thousands of vendored-package files."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _VENDOR_SKIP]
        if "_forge_portal.py" in filenames:
            yield Path(dirpath) / "_forge_portal.py"


def test_vendored_checkout_copies_match_or_are_known_drift(discovered) -> None:
    want = _sha(PORTAL_CORE / "forge_portal.py")
    drift: dict[str, str] = {}
    checked = 0
    for fid, local in discovered.items():
        if not local.checkout or not local.checkout.is_dir():
            continue
        for copy in _vendor_copies(local.checkout):
            # test fixtures under tests/ are not the vendored runtime
            if "tests" in copy.parts:
                continue
            checked += 1
            sha = _sha(copy)
            if sha != want and sha not in KNOWN_PREV_GENERATIONS:
                drift[fid] = str(copy)
    if not checked:
        pytest.skip("no vendored _forge_portal.py found in any checkout")
    assert not drift, (
        f"vendored copies out of sync with portal_core/forge_portal.py: {drift}"
    )


def test_installed_copies_are_consistent(discovered) -> None:
    """Every installed site-packages copy must carry the SAME vendored
    generation — mixed generations across installed forges would mean
    the ecosystem is running different portal contract surfaces."""
    hashes: dict[str, list[Path]] = {}
    for local in discovered.values():
        if not local.installed_python:
            continue
        sp = local.installed_python.parents[1] / "lib"
        for copy in _vendor_copies(sp):
            hashes.setdefault(_sha(copy), []).append(copy)
    if not hashes:
        pytest.skip("no installed vendored copies found")
    assert len(hashes) == 1, (
        "installed forges carry divergent _forge_portal generations: "
        + json.dumps({h[:12]: [str(p) for p in ps] for h, ps in hashes.items()})
    )


def test_no_mandatory_dependency_on_forge_cli(tmp_path, monkeypatch) -> None:
    """registry_ops degrades honestly when forge-cli is absent: the ops
    register and the state read returns an honest present=False doc."""
    sys.path.insert(0, str(PORTAL_CORE))
    monkeypatch.setenv("FORGE_CLI_HOME", str(tmp_path))
    monkeypatch.setenv("FORGE_HOME_OVERRIDE", str(tmp_path))
    import forge_portal as fp
    import registry_ops

    ops = registry_ops.registry_operations()
    assert ops, "registry ops must register regardless of CLI presence"
    state = fp.read_registry_state()
    assert state["schema"] == "forge-cli/RegistryState/v1"
    assert state["present"] is False  # honest absence, not a crash
