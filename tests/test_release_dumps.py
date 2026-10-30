"""Portal 2.2.1 Cycle 2 — release_dumps safe diagnostic dumps.

Exercises the dump generators on synthetic artifacts built in tmp dirs
(wheels are plain zips — no `build` module required), plus the real repo
for the inventory dump. Safety properties (redaction, no env values,
forbidden scan, --check exit codes) are asserted, not assumed.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import release_dumps as rd
import vendor as v

# ---------------------------------------------------------------------------
# fixtures / builders


def make_wheel(
    path: Path,
    name: str = "tinyforge",
    version: str = "0.0.1",
    members: dict[str, str] | None = None,
    metadata_extra: str = "",
) -> Path:
    dist = f"{name}-{version}.dist-info"
    payload = {
        f"{name}/__init__.py": "x = 1\n",
        f"{dist}/METADATA": (
            "Metadata-Version: 2.1\n"
            f"Name: {name}\n"
            f"Version: {version}\n"
            "Summary: tiny fixture\n"
            f"{metadata_extra}"
        ),
        f"{dist}/WHEEL": "Wheel-Version: 1.0\n",
        f"{dist}/RECORD": "",
    }
    payload.update(members or {})
    with zipfile.ZipFile(path, "w") as z:
        for arcname, text in payload.items():
            z.writestr(arcname, text)
    return path


def portal_members(pkg: str = "tinyforge") -> dict[str, str]:
    return {
        f"{pkg}/_forge_portal.py": "# vendored portal\n",
        f"{pkg}/_portal_telemetry.py": "# vendored telemetry\n",
        f"{pkg}/portal/assets/index.html": "<html>portal</html>\n",
    }


@pytest.fixture
def clean_wheel(tmp_path: Path) -> Path:
    return make_wheel(
        tmp_path / "tinyforge-0.0.1-py3-none-any.whl", members=portal_members()
    )


# ---------------------------------------------------------------------------
# wheel manifest


def test_wheel_manifest_schema_and_members(clean_wheel: Path) -> None:
    doc = rd.collect_wheel_manifest(clean_wheel, expect_portal=True, mode="safe")
    assert doc["schema"] == "forge/WheelManifest/1"
    assert doc["status"] == "OK"
    assert doc["artifact"]["kind"] == "wheel"
    assert doc["artifact"]["sha256"] == hashlib.sha256(
        clean_wheel.read_bytes()
    ).hexdigest()
    assert doc["file_count"] == len(doc["files"])
    by_path = {f["path"]: f for f in doc["files"]}
    assert "tinyforge/portal/assets/index.html" in by_path
    assert by_path["tinyforge/__init__.py"]["sha256"] == hashlib.sha256(
        b"x = 1\n"
    ).hexdigest()


def test_wheel_manifest_metadata_highlights(clean_wheel: Path) -> None:
    doc = rd.collect_wheel_manifest(clean_wheel, expect_portal=True, mode="safe")
    pkg = doc["package"]
    assert pkg["name"] == "tinyforge"
    assert pkg["version"] == "0.0.1"
    assert pkg["summary"] == "tiny fixture"
    assert isinstance(pkg["entry_points"], dict)


def test_wheel_manifest_required_members(clean_wheel: Path) -> None:
    doc = rd.collect_wheel_manifest(clean_wheel, expect_portal=True, mode="safe")
    req = doc["required"]
    for key in ("portal_index_html", "_forge_portal.py", "_portal_telemetry.py"):
        assert req[key]["expected"] is True
        assert req[key]["present"] is True
        assert req[key]["path"]


def test_wheel_manifest_missing_required_when_expected(tmp_path: Path) -> None:
    wheel = make_wheel(tmp_path / "bare-0.0.1-py3-none-any.whl", name="bare")
    doc = rd.collect_wheel_manifest(wheel, expect_portal=True, mode="safe")
    assert doc["status"] == "FINDINGS"
    assert all(
        r["present"] is False and r["expected"] is True
        for r in doc["required"].values()
    )
    assert any("required member" in p for p in doc["problems"])


def test_wheel_manifest_missing_required_not_expected(tmp_path: Path) -> None:
    wheel = make_wheel(tmp_path / "bare-0.0.1-py3-none-any.whl", name="bare")
    doc = rd.collect_wheel_manifest(wheel, expect_portal=False, mode="safe")
    assert doc["status"] == "OK"  # absent portal members are not findings
    assert all(r["expected"] is False for r in doc["required"].values())


def test_wheel_manifest_forbidden_detection(tmp_path: Path) -> None:
    wheel = make_wheel(
        tmp_path / "bad-0.0.1-py3-none-any.whl",
        name="bad",
        members={
            "bad/.env": "SECRET=1\n",
            "bad/.env.local": "SECRET=1\n",
            "bad/id_rsa": "PRIVATE\n",
            "bad/key.pem": "PEM\n",
            "bad/my_token.txt": "tok\n",
            "bad/client_secret.json": "{}\n",
            "bad/credential": "cred\n",
            "bad/.DS_Store": "x\n",
            "bad/.git/HEAD": "ref\n",
            "bad/__pycache__/m.pyc": "x\n",
            "bad/.pytest_cache/v/x": "x\n",
            "bad/test-results/r.xml": "x\n",
            "bad/normal.py": "y = 2\n",
        },
    )
    doc = rd.collect_wheel_manifest(wheel, expect_portal=False, mode="safe")
    assert doc["status"] == "FINDINGS"
    flagged = {f["path"] for f in doc["forbidden"]}
    for want in (
        "bad/.env",
        "bad/.env.local",
        "bad/id_rsa",
        "bad/key.pem",
        "bad/my_token.txt",
        "bad/client_secret.json",
        "bad/credential",
        "bad/.DS_Store",
        "bad/.git/HEAD",
        "bad/__pycache__/m.pyc",
        "bad/.pytest_cache/v/x",
        "bad/test-results/r.xml",
    ):
        assert want in flagged, want
    assert "bad/normal.py" not in flagged


def test_wheel_manifest_metadata_user_path_flagged(tmp_path: Path) -> None:
    wheel = make_wheel(
        tmp_path / "meta-0.0.1-py3-none-any.whl",
        name="meta",
        metadata_extra="Download-URL: file:///home/edgar/builds/meta.whl\n",
    )
    doc = rd.collect_wheel_manifest(wheel, expect_portal=False, mode="safe")
    assert doc["status"] == "FINDINGS"
    assert any(
        f["reason"] == "absolute user path inside metadata"
        for f in doc["forbidden"]
    )


def test_wheel_manifest_sdist(tmp_path: Path) -> None:
    import tarfile

    sdist = tmp_path / "tinyforge-0.0.1.tar.gz"
    with tarfile.open(sdist, "w:gz") as tf:
        data = (
            b"Metadata-Version: 2.1\nName: tinyforge\nVersion: 0.0.1\n"
        )
        info = tarfile.TarInfo("tinyforge-0.0.1/PKG-INFO")
        info.size = len(data)
        tf.addfile(info, __import__("io").BytesIO(data))
    doc = rd.collect_wheel_manifest(sdist, expect_portal=False, mode="safe")
    assert doc["artifact"]["kind"] == "sdist"
    assert doc["package"]["name"] == "tinyforge"
    assert doc["status"] == "OK"


def test_wheel_manifest_missing_artifact(tmp_path: Path) -> None:
    doc = rd.collect_wheel_manifest(
        tmp_path / "nope.whl", expect_portal=False, mode="safe"
    )
    assert doc["status"] == "ERROR"
    assert doc["problems"]


# ---------------------------------------------------------------------------
# forbidden patterns + redaction (unit level)


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.production",
        "sub/id_rsa",
        "sub/id_rsa.pub",
        "cert.pem",
        "api_token.txt",
        "my-SECRET-file",
        "client_credential.json",
        "x/.DS_Store",
        "x/.git/config",
        "x/__pycache__/m.cpython-312.pyc",
        "x/.pytest_cache/CACHEDIR.TAG",
        "x/test-results/junit.xml",
    ],
)
def test_forbidden_reasons_flags(path: str) -> None:
    assert rd.forbidden_reasons(path), path


@pytest.mark.parametrize(
    "path",
    ["src/app.py", "README.md", "portal/assets/index.html", "a/b/c.txt"],
)
def test_forbidden_reasons_clean(path: str) -> None:
    assert rd.forbidden_reasons(path) == []


def test_sanitize_user_paths() -> None:
    assert rd.sanitize_text("/home/edgar/x/y") == "<HOME>/x/y"
    assert rd.sanitize_text("/Users/edgar/x") == "<HOME>/x"
    out = rd.sanitize_text("C:\\Users\\edgar\\f.txt")
    assert "edgar" not in out and "<HOME>" in out
    assert rd.sanitize_text("/opt/tools/f") == "/opt/tools/f"


def test_sanitize_secrets() -> None:
    assert rd.sanitize_text("ghp_abcdefghijklmnopqrstuv") == "<REDACTED>"
    assert "edgar_token" not in rd.sanitize_text("api_key=edgar_token_value")
    out = rd.sanitize_text("Authorization: Bearer abcdef1234567890")
    assert "abcdef1234567890" not in out


def test_sanitize_recurses_structures() -> None:
    dirty = {
        "path": "/home/edgar/a",
        "list": ["/home/edgar/b", {"k": "token=supersecretvalue"}],
    }
    clean = rd.sanitize(dirty)
    blob = json.dumps(clean)
    assert "/home/edgar" not in blob
    assert "supersecretvalue" not in blob
    assert clean["list"][0] == "<HOME>/b"


def test_emitted_json_is_sanitized(tmp_path: Path, clean_wheel: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    doc = rd.collect_wheel_manifest(clean_wheel, expect_portal=True, mode="safe")
    doc["injected_home_path"] = str(Path.home() / "secrets" / "k.pem")
    rd.write_json(out, rd.F_WHEEL, doc)
    raw = (out / rd.F_WHEEL).read_text()
    assert str(Path.home()) not in raw
    assert "<HOME>" in raw


# ---------------------------------------------------------------------------
# inventory


def test_inventory_schema_fields() -> None:
    doc = rd.collect_inventory(ROOT, mode="safe")
    assert doc["schema"] == "forge/ReleaseInventory/1"
    assert doc["generated_at_utc"].endswith("Z")
    assert doc["mode"] == "safe"
    assert doc["repository"]["name"] == "forge-portal"
    assert doc["commit"]["sha"] is not None
    assert len(doc["commit"]["sha"]) == 40
    assert doc["package"]["name"] == "forge-portal-app"
    # asserted against the real manifest, not a pinned literal — version bumps
    # must not silently break the inventory contract test.
    import json as _json
    expected = _json.loads((ROOT / "package.json").read_text())["version"]
    assert doc["package"]["version"] == expected
    assert doc["package"]["ecosystem"] == "npm"
    assert doc["platform"]["system"]
    assert doc["platform"]["python"]
    assert doc["published_version"] == "unresolved"
    assert "environment" not in doc  # safe mode records no env data


def test_inventory_extended_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RELEASE_DUMPS_SENTINEL", "hunter2-secret")
    doc = rd.collect_inventory(ROOT, mode="extended")
    assert doc["mode"] == "extended"
    signals = doc["environment"]["ci_signals"]
    assert set(signals.values()) <= {"set", "unset"}  # presence only
    blob = json.dumps(rd.sanitize(doc))
    assert "hunter2-secret" not in blob
    assert "machine" in doc["platform"]


def test_inventory_remote_credentials_stripped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        rd, "git", lambda repo, *a: "https://x-access-token:abc123@github.com/o/r.git"
        if a[:2] == ("remote", "get-url")
        else None
    )
    doc = rd.collect_inventory(tmp_path, mode="safe")
    remote = doc["repository"]["remote"]
    assert "abc123" not in remote
    assert remote == "https://github.com/o/r"


# ---------------------------------------------------------------------------
# vendor integrity


def _vendor_one(forges_dir: Path, forge: str, *, drift: bool) -> Path:
    """Create a synthetic vendored forge checkout under forges_dir."""
    target = v.FORGES[forge]
    t = {"pkg": target} if isinstance(target, str) else target
    repo = forges_dir / forge
    pkg_dir = repo / t["pkg"]
    pkg_dir.mkdir(parents=True)
    assets_dir = repo / t.get("assets", "portal/assets")
    assets_dir.mkdir(parents=True)

    shutil.copyfile(v.SERVER_SRC, pkg_dir / "_forge_portal.py")
    telemetry_bytes = v.telemetry_source(t)
    if telemetry_bytes:
        (pkg_dir / "_portal_telemetry.py").write_bytes(telemetry_bytes)

    (assets_dir / "index.html").write_text("<html>a</html>", encoding="utf-8")
    (assets_dir / "chunk-a.js").write_text("var a=1;", encoding="utf-8")

    manifest = v.manifest_for(
        assets_dir,
        pkg_dir / "_forge_portal.py",
        telemetry_hash=(
            hashlib.sha256(telemetry_bytes).hexdigest() if telemetry_bytes else None
        ),
    )
    manifest_dir = repo / t.get("manifest", "portal/manifest.json")
    manifest_dir.parent.mkdir(parents=True, exist_ok=True)
    manifest_dir.write_text(json.dumps(manifest), encoding="utf-8")
    if drift:
        # written after the manifest → live file the manifest does not know
        (assets_dir / "extra.css").write_text("b{}", encoding="utf-8")
    return repo


def test_vendor_integrity_ok(tmp_path: Path) -> None:
    _vendor_one(tmp_path, "the-forge", drift=False)
    doc = rd.collect_vendor_integrity(tmp_path, mode="safe")
    rep = doc["forges"]["the-forge"]
    assert rep["status"] == "OK"
    assert rep["drift"] is False
    assert rep["server"]["matches_source"] is True
    assert rep["server"]["manifest_match"] is True
    assert rep["telemetry"]["manifest_match"] is True
    assert rep["assets"]["file_count"] == 2
    assert rep["manifest"]["schema"] == "forge/PortalAssets/1"
    assert rep["manifest"]["sha256"]
    # checkouts that do not exist are reported, not invented
    assert doc["forges"]["api-forge"]["status"] == "NOT_CHECKED_OUT"
    assert doc["summary"]["checked_out"] == 1


def test_vendor_integrity_drift_detected(tmp_path: Path) -> None:
    _vendor_one(tmp_path, "the-forge", drift=True)  # extra file not in manifest
    doc = rd.collect_vendor_integrity(tmp_path, mode="safe")
    rep = doc["forges"]["the-forge"]
    assert rep["status"] == "DRIFT"
    assert rep["drift"] is True
    assert rep["assets"]["extra"] == ["extra.css"]
    assert doc["status"] == "FINDINGS"
    assert doc["problems"]


def test_vendor_integrity_mismatched_and_missing(tmp_path: Path) -> None:
    repo = _vendor_one(tmp_path, "api-forge", drift=False)
    assets = repo / "portal" / "assets"
    (assets / "chunk-a.js").write_text("tampered();", encoding="utf-8")
    (assets / "index.html").unlink()
    doc = rd.collect_vendor_integrity(tmp_path, mode="safe")
    rep = doc["forges"]["api-forge"]
    assert rep["status"] == "DRIFT"
    assert rep["assets"]["missing"] == ["index.html"]
    assert rep["assets"]["mismatched"] == ["chunk-a.js"]


def test_vendor_integrity_no_manifest(tmp_path: Path) -> None:
    repo = tmp_path / "the-forge"
    (repo / "src" / "theforge").mkdir(parents=True)
    doc = rd.collect_vendor_integrity(tmp_path, mode="safe")
    assert doc["forges"]["the-forge"]["status"] == "NO_MANIFEST"
    assert doc["status"] == "FINDINGS"


# ---------------------------------------------------------------------------
# npm pack manifest


@pytest.mark.skipif(shutil.which("npm") is None, reason="npm not installed")
def test_npm_pack_manifest(tmp_path: Path) -> None:
    pkg = tmp_path / "pkg"
    (pkg / "__pycache__").mkdir(parents=True)
    (pkg / "package.json").write_text(
        json.dumps({"name": "tiny-npm", "version": "1.2.3"}), encoding="utf-8"
    )
    (pkg / "index.js").write_text("module.exports=1;", encoding="utf-8")
    (pkg / "__pycache__" / "m.pyc").write_text("x", encoding="utf-8")
    doc = rd.collect_npm_pack_manifest(pkg, mode="safe")
    assert doc["schema"] == "forge/NpmPackManifest/1"
    assert doc["package"]["name"] == "tiny-npm"
    assert doc["package"]["version"] == "1.2.3"
    assert doc["file_count"] >= 2
    paths = [f["path"] for f in doc["files"]]
    assert "index.js" in paths
    assert doc["status"] == "FINDINGS"
    assert "__pycache__/m.pyc" in {f["path"] for f in doc["forbidden"]}


def test_npm_pack_missing_dir(tmp_path: Path) -> None:
    doc = rd.collect_npm_pack_manifest(tmp_path / "nope", mode="safe")
    assert doc["status"] == "ERROR"
    assert doc["problems"]


# ---------------------------------------------------------------------------
# end-to-end: emitted files, checksums, summary, --check


def test_all_emits_bundle(tmp_path: Path, clean_wheel: Path) -> None:
    forges_dir = tmp_path / "forjas"
    _vendor_one(forges_dir, "the-forge", drift=False)
    out = tmp_path / "out"
    rc = rd.main(
        [
            "all",
            "--out",
            str(out),
            "--repo-dir",
            str(ROOT),
            "--forges-dir",
            str(forges_dir),
            "--artifact",
            str(clean_wheel),
            "--expect-portal",
        ]
    )
    assert rc == 0
    for name in (
        rd.F_INVENTORY,
        rd.F_VENDOR,
        rd.F_WHEEL,
        rd.F_SUMMARY,
        rd.F_CHECKSUMS,
    ):
        assert (out / name).is_file(), name
    assert not (out / rd.F_NPM).exists()  # no --npm-dir → skipped

    # checksums.sha256 covers every emitted artifact and verifies
    sums = (out / rd.F_CHECKSUMS).read_text().splitlines()
    covered = {}
    for line in sums:
        h, name = line.split("  ", 1)
        covered[name] = h
    assert rd.F_CHECKSUMS not in covered
    for name, h in covered.items():
        assert h == hashlib.sha256((out / name).read_bytes()).hexdigest()

    summary = (out / rd.F_SUMMARY).read_text()
    assert "forge/ReleaseInventory/1" in summary
    assert "forge/VendorIntegrity/1" in summary
    assert "forge/WheelManifest/1" in summary
    assert "the-forge" in summary


def test_check_mode_exit_codes(tmp_path: Path, clean_wheel: Path) -> None:
    out = tmp_path / "clean"
    rc = rd.main(
        ["wheel", "--out", str(out), "--artifact", str(clean_wheel), "--check"]
    )
    assert rc == 0

    bad = make_wheel(
        tmp_path / "bad-0.0.1-py3-none-any.whl",
        name="bad",
        members={"bad/.env": "SECRET=1\n"},
    )
    out2 = tmp_path / "bad"
    rc = rd.main(["wheel", "--out", str(out2), "--artifact", str(bad), "--check"])
    assert rc == 1


def test_check_mode_vendor_drift_fails(tmp_path: Path) -> None:
    forges_dir = tmp_path / "forjas"
    _vendor_one(forges_dir, "the-forge", drift=True)
    rc = rd.main(
        ["vendor", "--out", str(tmp_path / "o"), "--forges-dir", str(forges_dir), "--check"]
    )
    assert rc == 1


def test_extended_mode_warns(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    rc = rd.main(
        ["inventory", "--out", str(tmp_path / "o"), "--mode", "extended", "--repo-dir", str(ROOT)]
    )
    assert rc == 0
    assert "extended" in capsys.readouterr().err.lower()


def test_summarize_rebuilds_checksums(tmp_path: Path, clean_wheel: Path) -> None:
    out = tmp_path / "o"
    rd.main(["wheel", "--out", str(out), "--artifact", str(clean_wheel)])
    (out / rd.F_CHECKSUMS).unlink()
    rc = rd.main(["summarize", "--out", str(out)])
    assert rc == 0
    assert (out / rd.F_CHECKSUMS).is_file()
    assert (out / rd.F_SUMMARY).is_file()
