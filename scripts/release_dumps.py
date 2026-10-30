#!/usr/bin/env python3
# release_dumps.py — Portal 2.2.1 Cycle 2: SAFE DIAGNOSTIC DUMPS for release forensics.
#
# What it does, why, when:
#   - emits sanitized, versioned-schema JSON artifacts answering the five
#     release questions: what code originated the package, which workflow
#     produced it, which version was published, is the validated artifact
#     the published one, and is vendored content correct
#   - release-inventory.json   (forge/ReleaseInventory/1)  repo/commit/tag/version/workflow
#   - vendor-integrity.json    (forge/VendorIntegrity/1)   live vendored files vs manifest
#   - wheel-manifest.json      (forge/WheelManifest/1)     wheel/sdist member + METADATA audit
#   - npm-pack-manifest.json   (forge/NpmPackManifest/1)   `npm pack --dry-run --json` audit
#   - checksums.sha256 + release-summary.md rollup over every emitted artifact
#
# Security contract (mandatory):
#   - default mode is `safe`: no env var values, cookies, session tokens,
#     Authorization headers or SSH keys are ever collected or written
#   - absolute user paths (/home/<u>, /Users/<u>, C:\Users\<u>) are rewritten
#     to <HOME> before any byte reaches an artifact
#   - common token/key shapes are replaced with <REDACTED>
#   - `--mode extended` adds host/CI presence signals (names only, never
#     values) and prints a warning; secrets remain excluded
#   - no network calls; registry freshness stays `unresolved` by design
#
# Usage:
#   python scripts/release_dumps.py all [--out artifacts/release] [--check]
#   python scripts/release_dumps.py inventory|vendor|wheel|npm|summarize ...
#   --check exits 1 when any dump records forbidden files, drift, missing
#   required members or collector errors.
#
# Schemas are documented in docs/release/dump-schemas.md.

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tomllib
import zipfile
from datetime import UTC, datetime
from email.parser import Parser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent  # the forjas/ parent holding sibling checkouts
SCRIPT_DIR = Path(__file__).resolve().parent

# The forge map and canonical sources are owned by vendor.py — import them so
# this tool can never drift from the vendoring contract it audits.
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
try:
    from vendor import FORGES, SERVER_SRC, TELEMETRY_SRC, telemetry_source
except ImportError:  # pragma: no cover — vendor.py unavailable: degrade honestly
    FORGES = {}
    SERVER_SRC = ROOT / "portal_core" / "forge_portal.py"
    TELEMETRY_SRC = ROOT / "portal_core" / "telemetry.py"

    def telemetry_source(target: dict[str, str]) -> bytes | None:
        return TELEMETRY_SRC.read_bytes() if TELEMETRY_SRC.is_file() else None


SCHEMA_INVENTORY = "forge/ReleaseInventory/1"
SCHEMA_VENDOR = "forge/VendorIntegrity/1"
SCHEMA_WHEEL = "forge/WheelManifest/1"
SCHEMA_NPM = "forge/NpmPackManifest/1"

F_INVENTORY = "release-inventory.json"
F_VENDOR = "vendor-integrity.json"
F_WHEEL = "wheel-manifest.json"
F_NPM = "npm-pack-manifest.json"
F_SUMMARY = "release-summary.md"
F_CHECKSUMS = "checksums.sha256"
ARTIFACT_NAMES = (F_INVENTORY, F_VENDOR, F_WHEEL, F_NPM)

SAFE = "safe"
EXTENDED = "extended"

# Forbidden files: flagged in artifact/member listings and fail `--check`.
FORBIDDEN_BASENAME_GLOBS = (
    ".env*",
    "*id_rsa*",
    "*.pem",
    "*token*",
    "*secret*",
    "*credential*",
    ".DS_Store",
)
FORBIDDEN_SEGMENTS = (".git", "__pycache__", ".pytest_cache", "test-results")

# Absolute user paths are never written; this regex both flags them in
# metadata and powers the <HOME> rewrite.
USER_PATH_RE = re.compile(
    r"(/home/[^\s\"'/\\]+|/Users/[^\s\"'/\\]+|[A-Za-z]:\\Users\\[^\\\"'\s]+)"
)

# Secret-shaped values → <REDACTED>. (pattern, replacement) pairs; callable
# replacements keep a non-secret prefix such as "Bearer " or the key name.
SECRET_RES: list[tuple[re.Pattern[str], object]] = [
    (re.compile(r"ghp_[A-Za-z0-9]{10,}"), "<REDACTED>"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{10,}"), "<REDACTED>"),
    (re.compile(r"gho_[A-Za-z0-9]{10,}"), "<REDACTED>"),
    (re.compile(r"ghu_[A-Za-z0-9]{10,}"), "<REDACTED>"),
    (re.compile(r"glpat-[A-Za-z0-9_-]{10,}"), "<REDACTED>"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "<REDACTED>"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "<REDACTED>"),
    # 2.2.2-F2: provider-prefixed tokens (npm / PyPI / GCP / Google OAuth)
    (re.compile(r"npm_[A-Za-z0-9]{20,}"), "<REDACTED>"),
    (re.compile(r"pypi-[A-Za-z0-9_-]{16,}"), "<REDACTED>"),
    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), "<REDACTED>"),
    (re.compile(r"ya29\.[A-Za-z0-9_-]{10,}"), "<REDACTED>"),
    # PEM / SSH private-key blocks (multi-line)
    (
        re.compile(
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----"
            r"[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----"
        ),
        "<REDACTED>",
    ),
    (
        re.compile(r"(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}"),
        lambda m: m.group(1) + "<REDACTED>",
    ),
    (
        re.compile(
            r"(?i)((?:password|passwd|secret|api[_-]?key|token|access[_-]?token"
            r"|auth[_-]?token|refresh[_-]?token|session[_-]?token"
            r"|private[_-]?key|aws_secret_access_key|aws_session_token"
            r"|client_secret|webhook_secret)\s*[:=]\s*)[^\s\"',;]{4,}"
        ),
        lambda m: m.group(1) + "<REDACTED>",
    ),
]

# CI signal names whose *presence* (never value) may be reported in
# extended mode.
CI_ENV_NAMES = (
    "CI",
    "GITHUB_ACTIONS",
    "GITHUB_REF",
    "GITHUB_REF_NAME",
    "GITHUB_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_WORKFLOW",
    "GITLAB_CI",
    "BUILD_ID",
    "BUILD_NUMBER",
    "TF_BUILD",
    "JENKINS_URL",
    "CIRCLECI",
)

UNRESOLVED = "unresolved"


# --------------------------------------------------------------------------
# small helpers


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sanitize_text(text: str) -> str:
    """Rewrite user paths to <HOME> and secret shapes to <REDACTED>."""
    home = str(Path.home())
    if home and home not in ("/", "\\"):
        text = text.replace(home, "<HOME>")
    text = USER_PATH_RE.sub("<HOME>", text)
    for rx, repl in SECRET_RES:
        text = rx.sub(repl, text)  # type: ignore[arg-type]
    return text


def sanitize(obj):
    if isinstance(obj, str):
        return sanitize_text(obj)
    if isinstance(obj, list):
        return [sanitize(x) for x in obj]
    if isinstance(obj, dict):
        return {
            (sanitize_text(k) if isinstance(k, str) else k): sanitize(v)
            for k, v in obj.items()
        }
    return obj


def forbidden_reasons(rel_path: str) -> list[str]:
    """Return every reason `rel_path` is forbidden, or []."""
    reasons: list[str] = []
    parts = [seg for seg in re.split(r"[\\/]+", rel_path.strip("/")) if seg]
    if not parts:
        return reasons
    base = parts[-1]
    lowered = [seg.lower() for seg in parts]
    for glob in FORBIDDEN_BASENAME_GLOBS:
        if fnmatch.fnmatchcase(base.lower(), glob.lower()):
            reasons.append(f"basename matches forbidden pattern {glob!r}")
    for seg in lowered[:-1]:
        if seg in FORBIDDEN_SEGMENTS:
            reasons.append(f"inside forbidden directory {seg!r}/")
    if lowered[-1] in FORBIDDEN_SEGMENTS:
        reasons.append(f"name is forbidden directory {lowered[-1]!r}/")
    return reasons


def forbidden_scan(rel_paths: list[str]) -> list[dict]:
    findings: list[dict] = []
    for rel in rel_paths:
        for reason in forbidden_reasons(rel):
            findings.append({"path": rel, "reason": reason})
    return findings


def git(repo: Path, *args: str) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None


def sanitize_remote(url: str | None) -> str | None:
    """Strip credentials/userinfo from a remote URL; keep host+path."""
    if not url:
        return url
    url = re.sub(r"(https?://)[^/@\s]+@", r"\1", url)
    return url.removesuffix(".git")


def iter_files(root: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    if root.is_dir():
        for p in sorted(root.rglob("*")):
            if p.is_file():
                out.append((p.relative_to(root).as_posix(), p))
    return out


def detect_package(repo_dir: Path) -> dict:
    pkg_json = repo_dir / "package.json"
    if pkg_json.is_file():
        try:
            data = json.loads(pkg_json.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
        return {
            "name": data.get("name"),
            "version": data.get("version"),
            "ecosystem": "npm",
            "source_file": "package.json",
        }
    pyproject = repo_dir / "pyproject.toml"
    if pyproject.is_file():
        try:
            data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        except (tomllib.TOMLDecodeError, OSError):
            data = {}
        proj = data.get("project") or {}
        return {
            "name": proj.get("name"),
            "version": proj.get("version"),
            "ecosystem": "python",
            "source_file": "pyproject.toml",
        }
    return {
        "name": None,
        "version": None,
        "ecosystem": UNRESOLVED,
        "source_file": None,
    }


# --------------------------------------------------------------------------
# 1) release-inventory.json — forge/ReleaseInventory/1


def collect_inventory(repo_dir: Path, mode: str) -> dict:
    repo_dir = Path(repo_dir)
    workflows_dir = repo_dir / ".github" / "workflows"
    workflows = sorted(p.name for p in workflows_dir.glob("*.y*ml"))
    workflow_file = next(
        (w for w in workflows if re.search(r"publish|release", w, re.IGNORECASE)), None
    )
    latest_tag = git(repo_dir, "describe", "--tags", "--abbrev=0")
    if latest_tag is None:
        tag_listing = git(repo_dir, "tag", "--sort=-v:refname")
        latest_tag = tag_listing.splitlines()[0] if tag_listing else None

    doc: dict = {
        "schema": SCHEMA_INVENTORY,
        "generated_at_utc": utcnow(),
        "mode": mode,
        "repository": {
            "name": repo_dir.resolve().name,
            "remote": sanitize_remote(git(repo_dir, "remote", "get-url", "origin")),
        },
        "commit": {
            "sha": git(repo_dir, "rev-parse", "HEAD"),
            "branch": git(repo_dir, "rev-parse", "--abbrev-ref", "HEAD"),
            "dirty": bool(git(repo_dir, "status", "--porcelain")),
        },
        "tag": git(repo_dir, "describe", "--tags", "--exact-match", "HEAD"),
        "latest_tag": latest_tag,
        "package": detect_package(repo_dir),
        "workflow_file": workflow_file,
        "workflow_path": (
            f".github/workflows/{workflow_file}" if workflow_file else None
        ),
        "workflows": workflows,
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
        },
        # Registry queries are outside the offline boundary: the published
        # version can only be cross-checked externally against this dump.
        "published_version": UNRESOLVED,
        "notes": [
            (
                "published_version is unresolved: registry lookups are outside "
                "the offline boundary; compare `commit.sha`/`package.version` "
                "against the registry record externally"
            )
        ],
    }
    if mode == EXTENDED:
        doc["platform"]["node"] = platform.node()
        doc["platform"]["machine"] = platform.machine()
        doc["environment"] = {
            "ci_signals": {
                name: ("set" if os.environ.get(name) else "unset")
                for name in CI_ENV_NAMES
            },
            "note": "presence signals only — environment values are never "
            "collected in any mode",
        }
    return doc


# --------------------------------------------------------------------------
# 2) vendor-integrity.json — forge/VendorIntegrity/1


def inspect_forge(repo: Path, target) -> dict:
    out: dict = {"checkout": repo.is_dir()}
    if not repo.is_dir():
        out["status"] = "NOT_CHECKED_OUT"
        out["drift"] = False
        return out

    if isinstance(target, str):
        target = {"pkg": target}
    server_path = repo / target["pkg"] / "_forge_portal.py"
    telemetry_path = repo / target["pkg"] / "_portal_telemetry.py"
    assets_dir = repo / target.get("assets", "portal/assets")
    manifest_path = repo / target.get("manifest", "portal/manifest.json")

    manifest_doc: dict = {}
    manifest_ok = manifest_path.is_file()
    if manifest_ok:
        try:
            manifest_doc = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest_doc = {"_parse_error": True}
    manifest_files = manifest_doc.get("files") or {}
    if not isinstance(manifest_files, dict):
        manifest_files = {}

    out["manifest"] = {
        "path": manifest_path.relative_to(repo).as_posix(),
        "present": manifest_ok,
        "sha256": sha256_file(manifest_path) if manifest_ok else None,
        "schema": manifest_doc.get("schema"),
        "portal_version": manifest_doc.get("portal_version"),
        "file_count": len(manifest_files),
        "parse_error": bool(manifest_doc.get("_parse_error")),
    }

    server_sha = sha256_file(server_path) if server_path.is_file() else None
    out["server"] = {
        "path": server_path.relative_to(repo).as_posix(),
        "present": server_path.is_file(),
        "sha256": server_sha,
        "matches_source": (
            server_sha == sha256_file(SERVER_SRC)
            if server_sha and SERVER_SRC.is_file()
            else None
        ),
        "manifest_sha256": manifest_doc.get("server_sha256"),
        "manifest_match": (
            server_sha == manifest_doc.get("server_sha256")
            if server_sha and manifest_doc.get("server_sha256")
            else None
        ),
    }

    expected_telemetry = telemetry_source(target)
    expected_telemetry_sha = (
        sha256_bytes(expected_telemetry) if expected_telemetry is not None else None
    )
    telemetry_sha = sha256_file(telemetry_path) if telemetry_path.is_file() else None
    out["telemetry"] = {
        "path": telemetry_path.relative_to(repo).as_posix(),
        "present": telemetry_path.is_file(),
        "sha256": telemetry_sha,
        "matches_source": (
            telemetry_sha == expected_telemetry_sha
            if telemetry_sha and expected_telemetry_sha
            else None
        ),
        "manifest_sha256": manifest_doc.get("telemetry_sha256"),
        "manifest_match": (
            telemetry_sha == manifest_doc.get("telemetry_sha256")
            if telemetry_sha and manifest_doc.get("telemetry_sha256")
            else None
        ),
    }

    live: dict[str, dict] = {}
    for rel, p in iter_files(assets_dir):
        live[rel] = {"sha256": sha256_file(p), "bytes": p.stat().st_size}
    missing = sorted(set(manifest_files) - set(live))
    extra = sorted(set(live) - set(manifest_files))
    mismatched = sorted(
        rel
        for rel in set(manifest_files) & set(live)
        if manifest_files[rel].get("sha256") != live[rel]["sha256"]
    )
    out["assets"] = {
        "path": assets_dir.relative_to(repo).as_posix(),
        "present": assets_dir.is_dir(),
        "file_count": len(live),
        "total_bytes": sum(f["bytes"] for f in live.values()),
        "files": live,
        "missing": missing,
        "extra": extra,
        "mismatched": mismatched,
    }

    scan_paths = list(live)
    for p in (server_path, telemetry_path):
        if p.is_file():
            scan_paths.append(p.relative_to(repo).as_posix())
    out["forbidden"] = forbidden_scan(scan_paths)

    problems = (
        missing
        or extra
        or mismatched
        or out["forbidden"]
        or out["manifest"].get("parse_error")
    )
    module_drift = (
        out["server"]["manifest_match"] is False
        or out["telemetry"]["manifest_match"] is False
        or out["server"]["matches_source"] is False
        or out["telemetry"]["matches_source"] is False
        or (expected_telemetry_sha and not telemetry_path.is_file())
        or not server_path.is_file()
    )
    out["drift"] = bool(problems or module_drift)
    if not manifest_ok:
        out["status"] = "NO_MANIFEST"
        out["drift"] = True  # expected-vendored forge without manifest = drift
    else:
        out["status"] = "DRIFT" if out["drift"] else "OK"
    return out


def collect_vendor_integrity(forges_dir: Path, mode: str) -> dict:
    forges_dir = Path(forges_dir)
    forges: dict[str, dict] = {}
    problems: list[str] = []
    for name, target in FORGES.items():
        report = inspect_forge(forges_dir / name, target)
        forges[name] = report
        if report.get("status") in ("DRIFT", "NO_MANIFEST"):
            problems.append(f"{name}: {report['status']}")
        for f in report.get("forbidden") or []:
            problems.append(f"{name}: forbidden {f['path']} ({f['reason']})")

    summary = {
        "forges_known": len(FORGES),
        "checked_out": sum(1 for f in forges.values() if f.get("checkout")),
        "ok": sum(1 for f in forges.values() if f.get("status") == "OK"),
        "drifted": sum(1 for f in forges.values() if f.get("drift")),
        "not_checked_out": sum(
            1 for f in forges.values() if f.get("status") == "NOT_CHECKED_OUT"
        ),
    }
    return {
        "schema": SCHEMA_VENDOR,
        "generated_at_utc": utcnow(),
        "mode": mode,
        "forges_dir": str(forges_dir),
        "source": {
            "server_sha256": sha256_file(SERVER_SRC) if SERVER_SRC.is_file() else None,
            "telemetry_sha256": (
                sha256_file(TELEMETRY_SRC) if TELEMETRY_SRC.is_file() else None
            ),
        },
        "forges": forges,
        "summary": summary,
        "problems": problems,
        "status": "FINDINGS" if problems else "OK",
    }


# --------------------------------------------------------------------------
# 3) wheel-manifest.json — forge/WheelManifest/1


REQUIRED_MEMBERS = {
    "portal_index_html": lambda n: n.endswith("index.html") and "portal" in n.lower(),
    "_forge_portal.py": lambda n: n.endswith("_forge_portal.py"),
    "_portal_telemetry.py": lambda n: n.endswith("_portal_telemetry.py"),
}


def _read_zip_members(path: Path) -> tuple[list[dict], dict[str, str]]:
    members: list[dict] = []
    texts: dict[str, str] = {}
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            data = zf.read(info.filename)
            members.append(
                {
                    "path": info.filename,
                    "bytes": info.file_size,
                    "sha256": sha256_bytes(data),
                }
            )
            base = info.filename.rsplit("/", 1)[-1]
            if base in ("METADATA", "PKG-INFO", "entry_points.txt", "WHEEL"):
                texts[base] = data.decode("utf-8", "replace")
    return members, texts


def _read_tar_members(path: Path) -> tuple[list[dict], dict[str, str]]:
    members: list[dict] = []
    texts: dict[str, str] = {}
    with tarfile.open(path) as tf:
        for info in tf.getmembers():
            if not info.isfile():
                continue
            fobj = tf.extractfile(info)
            data = fobj.read() if fobj else b""
            members.append(
                {
                    "path": info.name,
                    "bytes": info.size,
                    "sha256": sha256_bytes(data),
                }
            )
            base = info.name.rsplit("/", 1)[-1]
            if base in ("METADATA", "PKG-INFO", "entry_points.txt", "WHEEL"):
                texts[base] = data.decode("utf-8", "replace")
    return members, texts


def parse_metadata(text: str | None) -> dict:
    if not text:
        return {
            "name": None,
            "version": None,
            "summary": None,
            "requires_dist": [],
            "license": None,
        }
    msg = Parser().parsestr(text)
    return {
        "name": msg.get("Name"),
        "version": msg.get("Version"),
        "summary": msg.get("Summary"),
        "license": msg.get("License") or msg.get("License-Expression"),
        "requires_dist": msg.get_all("Requires-Dist") or [],
    }


def parse_entry_points(text: str | None) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if not text:
        return out
    section: str | None = None
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"\[(.+)\]", line)
        if m:
            section = m.group(1)
            out.setdefault(section, [])
        elif section and "=" in line:
            out[section].append(line)
    return out


def metadata_findings(texts: dict[str, str]) -> list[dict]:
    """Flag absolute user paths and secret-shaped strings inside metadata."""
    findings: list[dict] = []
    for name, text in texts.items():
        for match in USER_PATH_RE.findall(text):
            findings.append(
                {
                    "path": name,
                    "reason": "absolute user path inside metadata",
                    "match": sanitize_text(match),
                }
            )
        for rx, _repl in SECRET_RES:
            for _m in rx.finditer(text):
                findings.append(
                    {
                        "path": name,
                        "reason": "secret-shaped string inside metadata",
                        "match": "<REDACTED>",
                    }
                )
    return findings


def collect_wheel_manifest(artifact: Path, expect_portal: bool, mode: str) -> dict:
    artifact = Path(artifact)
    problems: list[str] = []
    doc: dict = {
        "schema": SCHEMA_WHEEL,
        "generated_at_utc": utcnow(),
        "mode": mode,
        "artifact": {
            "path": str(artifact),
            "name": artifact.name,
            "present": artifact.is_file(),
        },
    }
    if not artifact.is_file():
        doc["status"] = "ERROR"
        doc["error"] = "artifact not found"
        doc["problems"] = ["artifact not found"]
        return doc

    doc["artifact"]["sha256"] = sha256_file(artifact)
    doc["artifact"]["bytes"] = artifact.stat().st_size

    suffixes = "".join(artifact.suffixes).lower()
    try:
        if suffixes.endswith((".whl", ".zip")):
            kind = "wheel"
            members, texts = _read_zip_members(artifact)
        elif re.search(r"\.(tar\.gz|tgz|tar\.bz2|tar\.xz|tar)$", artifact.name.lower()):
            kind = "sdist"
            members, texts = _read_tar_members(artifact)
        else:
            doc["status"] = "ERROR"
            doc["error"] = f"unsupported artifact type: {artifact.name}"
            doc["problems"] = [doc["error"]]
            return doc
    except (zipfile.BadZipFile, tarfile.TarError, OSError) as e:
        doc["status"] = "ERROR"
        doc["error"] = f"cannot read archive: {e}"
        doc["problems"] = [doc["error"]]
        return doc

    doc["artifact"]["kind"] = kind
    names = [m["path"] for m in members]

    metadata_text = texts.get("METADATA") or texts.get("PKG-INFO")
    doc["package"] = parse_metadata(metadata_text)
    doc["package"]["entry_points"] = parse_entry_points(texts.get("entry_points.txt"))
    doc["files"] = members
    doc["file_count"] = len(members)
    doc["total_bytes"] = sum(m["bytes"] for m in members)

    required: dict[str, dict] = {}
    for key, pred in REQUIRED_MEMBERS.items():
        hit = next((n for n in names if pred(n)), None)
        required[key] = {
            "expected": expect_portal,
            "present": hit is not None,
            "path": hit,
        }
        if expect_portal and hit is None:
            problems.append(f"required member missing: {key}")
    doc["required"] = required

    forbidden = forbidden_scan(names) + metadata_findings(texts)
    doc["forbidden"] = forbidden
    for f in forbidden:
        problems.append(f"forbidden {f['path']} ({f['reason']})")

    doc["problems"] = problems
    doc["status"] = "FINDINGS" if problems else "OK"
    return doc


# --------------------------------------------------------------------------
# 4) npm-pack-manifest.json — forge/NpmPackManifest/1


def _parse_npm_json(stdout: str) -> dict | None:
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        start = stdout.find("[")
        if start < 0:
            return None
        try:
            data = json.loads(stdout[start:])
        except json.JSONDecodeError:
            return None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None


def collect_npm_pack_manifest(npm_dir: Path, mode: str) -> dict:
    npm_dir = Path(npm_dir)
    problems: list[str] = []
    doc: dict = {
        "schema": SCHEMA_NPM,
        "generated_at_utc": utcnow(),
        "mode": mode,
        "dir": str(npm_dir),
    }
    npm = shutil.which("npm")
    if npm is None:
        doc["status"] = "ERROR"
        doc["error"] = "npm executable not found"
        doc["problems"] = [doc["error"]]
        return doc
    if not (npm_dir / "package.json").is_file():
        doc["status"] = "ERROR"
        doc["error"] = f"no package.json in {npm_dir}"
        doc["problems"] = [doc["error"]]
        return doc

    try:
        proc = subprocess.run(
            [npm, "pack", "--dry-run", "--json", "--ignore-scripts"],
            cwd=npm_dir,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        doc["status"] = "ERROR"
        doc["error"] = f"npm pack failed to run: {e}"
        doc["problems"] = [doc["error"]]
        return doc

    report = _parse_npm_json(proc.stdout)
    if proc.returncode != 0 or report is None:
        doc["status"] = "ERROR"
        doc["error"] = f"npm pack --dry-run exited {proc.returncode}"
        doc["stderr_tail"] = proc.stderr.strip().splitlines()[-5:]
        doc["problems"] = [doc["error"]]
        return doc

    files = [
        {
            "path": f.get("path"),
            "bytes": f.get("size"),
            "mode": f.get("mode"),
        }
        for f in report.get("files") or []
        if isinstance(f, dict)
    ]
    doc["package"] = {
        "name": report.get("name"),
        "version": report.get("version"),
        "filename": report.get("filename"),
        "integrity": report.get("integrity"),
        "shasum": report.get("shasum"),
        "package_size": report.get("packageSize"),
        "unpacked_size": report.get("unpackedSize"),
        "total_files": report.get("totalFiles"),
    }
    doc["files"] = files
    doc["file_count"] = len(files)
    doc["total_bytes"] = sum(f["bytes"] or 0 for f in files)

    forbidden = forbidden_scan([f["path"] for f in files if f.get("path")])
    doc["forbidden"] = forbidden
    for f in forbidden:
        problems.append(f"forbidden {f['path']} ({f['reason']})")

    doc["problems"] = problems
    doc["status"] = "FINDINGS" if problems else "OK"
    return doc


# --------------------------------------------------------------------------
# 5+6) checksums.sha256 + release-summary.md


def write_json(out_dir: Path, name: str, doc: dict) -> Path:
    path = out_dir / name
    path.write_text(
        json.dumps(sanitize(doc), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def render_summary(docs: dict[str, dict], mode: str) -> str:
    lines = [
        "# Release diagnostic summary",
        "",
        f"Generated: {utcnow()} · mode: `{mode}`",
        "",
        (
            "Safety: no env var values, cookies, tokens, Authorization headers "
            "or SSH keys are collected; user paths appear as `<HOME>`; "
            "secret-shaped strings appear as `<REDACTED>`."
        ),
        "",
    ]

    inv = docs.get(F_INVENTORY)
    if inv:
        commit = inv.get("commit") or {}
        pkg = inv.get("package") or {}
        sha = (commit.get("sha") or UNRESOLVED)[:12]
        lines += [
            "## Inventory — `forge/ReleaseInventory/1`",
            "",
            (
                f"- repository: `{inv.get('repository', {}).get('name')}` "
                f"@ `{sha}` (branch `{commit.get('branch')}`, "
                f"dirty={commit.get('dirty')})"
            ),
            (
                f"- tag on HEAD: `{inv.get('tag') or 'none'}` · latest tag: "
                f"`{inv.get('latest_tag') or 'none'}`"
            ),
            (
                f"- package: `{pkg.get('name')}` {pkg.get('version')} "
                f"({pkg.get('ecosystem')})"
            ),
            f"- workflow: `{inv.get('workflow_path') or 'none'}`",
            (
                "- published_version: `unresolved` — registry lookups are "
                "outside the offline boundary; compare `commit.sha` and "
                "`package.version` against the registry record externally"
            ),
            "",
        ]

    ven = docs.get(F_VENDOR)
    if ven:
        s = ven.get("summary") or {}
        lines += [
            "## Vendor integrity — `forge/VendorIntegrity/1`",
            "",
            (
                f"Forges dir: `{ven.get('forges_dir')}` · "
                f"{s.get('checked_out')}/{s.get('forges_known')} checkouts · "
                f"{s.get('ok')} OK · {s.get('drifted')} drifted"
            ),
            "",
            "| forge | status | files | missing | extra | mismatched |",
            "|---|---|---|---|---|---|",
        ]
        for name, f in (ven.get("forges") or {}).items():
            assets = f.get("assets") or {}
            lines.append(
                f"| {name} | {f.get('status')} | "
                f"{assets.get('file_count', '-')} | "
                f"{len(assets.get('missing') or [])} | "
                f"{len(assets.get('extra') or [])} | "
                f"{len(assets.get('mismatched') or [])} |"
            )
        lines.append("")

    whe = docs.get(F_WHEEL)
    if whe:
        art = whe.get("artifact") or {}
        pkg = whe.get("package") or {}
        req = whe.get("required") or {}
        missing_req = [
            k for k, r in req.items() if r.get("expected") and not r.get("present")
        ]
        lines += [
            "## Artifact manifest — `forge/WheelManifest/1`",
            "",
            (
                f"- artifact: `{art.get('name')}` ({art.get('kind', '?')}, "
                f"{art.get('bytes')} bytes)"
            ),
            (
                f"- sha256: `{art.get('sha256')}` — compare this against the "
                "registry/publish record to answer “is the validated "
                "artifact the published one”"
            ),
            f"- package: `{pkg.get('name')}` {pkg.get('version')}",
            (
                f"- members: {whe.get('file_count')} files, "
                f"{whe.get('total_bytes')} bytes unpacked"
            ),
            (
                "- required members missing: "
                f"{', '.join(missing_req) if missing_req else 'none'}"
            ),
            f"- forbidden findings: {len(whe.get('forbidden') or [])}",
            "",
        ]
        for f in whe.get("forbidden") or []:
            lines.append(f"  - `{f['path']}` — {f['reason']}")
        if whe.get("forbidden"):
            lines.append("")

    npm = docs.get(F_NPM)
    if npm:
        pkg = npm.get("package") or {}
        lines += [
            "## npm pack — `forge/NpmPackManifest/1`",
            "",
            f"- dir: `{npm.get('dir')}`",
            (
                f"- package: `{pkg.get('name')}` {pkg.get('version')} "
                f"(integrity `{pkg.get('integrity')}`)"
            ),
            (
                f"- members: {npm.get('file_count')} files, "
                f"{npm.get('total_bytes')} bytes unpacked"
            ),
            f"- forbidden findings: {len(npm.get('forbidden') or [])}",
            f"- status: {npm.get('status')}",
            "",
        ]
        for f in npm.get("forbidden") or []:
            lines.append(f"  - `{f['path']}` — {f['reason']}")
        if npm.get("forbidden"):
            lines.append("")

    for name in ARTIFACT_NAMES:
        if name not in docs:
            lines.append(f"_`{name}` not collected in this run._")
            lines.append("")
    lines += [
        "## Integrity",
        "",
        f"`{F_CHECKSUMS}` covers every emitted artifact in this directory.",
        "",
    ]
    return "\n".join(lines)


def write_checksums(out_dir: Path) -> Path:
    lines = []
    for p in sorted(out_dir.iterdir()):
        if p.is_file() and p.name != F_CHECKSUMS:
            lines.append(f"{sha256_file(p)}  {p.name}")
    path = out_dir / F_CHECKSUMS
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def finalize(out_dir: Path, docs: dict[str, dict], mode: str) -> None:
    summary = out_dir / F_SUMMARY
    summary.write_text(sanitize_text(render_summary(docs, mode)), encoding="utf-8")
    sums = write_checksums(out_dir)
    print(f"  wrote {summary.relative_to(out_dir)}")
    print(f"  wrote {sums.relative_to(out_dir)} ({len(sums.read_text().splitlines())} entries)")


# --------------------------------------------------------------------------
# command plumbing


def _doc_problems(name: str, doc: dict) -> list[str]:
    problems = list(doc.get("problems") or [])
    if name == F_INVENTORY:
        return problems
    if doc.get("status") == "ERROR":
        problems.append(doc.get("error") or f"{name}: collector error")
    return problems


def emit(out_dir: Path, name: str, doc: dict) -> list[str]:
    write_json(out_dir, name, doc)
    status = doc.get("status", "OK")
    problems = _doc_problems(name, doc)
    mark = "OK" if status in ("OK", None) and not problems else "FINDINGS"
    if status == "ERROR":
        mark = "ERROR"
    print(f"  wrote {name} [{mark}]")
    for p in problems:
        print(f"    ! {p}")
    return problems


def cmd_inventory(args) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    docs: dict[str, dict] = {}
    doc = collect_inventory(Path(args.repo_dir), args.mode)
    docs[F_INVENTORY] = doc
    problems = emit(out_dir, F_INVENTORY, doc)
    finalize(out_dir, docs, args.mode)
    return _exit_code(args, problems)


def cmd_vendor(args) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    docs: dict[str, dict] = {}
    doc = collect_vendor_integrity(Path(args.forges_dir), args.mode)
    docs[F_VENDOR] = doc
    problems = emit(out_dir, F_VENDOR, doc)
    finalize(out_dir, docs, args.mode)
    return _exit_code(args, problems)


def cmd_wheel(args) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    docs: dict[str, dict] = {}
    doc = collect_wheel_manifest(Path(args.artifact), args.expect_portal, args.mode)
    docs[F_WHEEL] = doc
    problems = emit(out_dir, F_WHEEL, doc)
    finalize(out_dir, docs, args.mode)
    return _exit_code(args, problems)


def cmd_npm(args) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    docs: dict[str, dict] = {}
    doc = collect_npm_pack_manifest(Path(args.npm_dir), args.mode)
    docs[F_NPM] = doc
    problems = emit(out_dir, F_NPM, doc)
    finalize(out_dir, docs, args.mode)
    return _exit_code(args, problems)


def cmd_all(args) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    docs: dict[str, dict] = {}
    problems: list[str] = []

    doc = collect_inventory(Path(args.repo_dir), args.mode)
    docs[F_INVENTORY] = doc
    problems += emit(out_dir, F_INVENTORY, doc)

    doc = collect_vendor_integrity(Path(args.forges_dir), args.mode)
    docs[F_VENDOR] = doc
    problems += emit(out_dir, F_VENDOR, doc)

    if args.artifact:
        doc = collect_wheel_manifest(Path(args.artifact), args.expect_portal, args.mode)
        docs[F_WHEEL] = doc
        problems += emit(out_dir, F_WHEEL, doc)
    else:
        print("  skipped wheel-manifest.json (no --artifact)")

    if args.npm_dir:
        doc = collect_npm_pack_manifest(Path(args.npm_dir), args.mode)
        docs[F_NPM] = doc
        problems += emit(out_dir, F_NPM, doc)
    else:
        print("  skipped npm-pack-manifest.json (no --npm-dir)")

    finalize(out_dir, docs, args.mode)
    return _exit_code(args, problems)


def cmd_summarize(args) -> int:
    out_dir = Path(args.out)
    docs: dict[str, dict] = {}
    for name in ARTIFACT_NAMES:
        p = out_dir / name
        if p.is_file():
            try:
                docs[name] = json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                print(f"  warning: {name} is not valid JSON — skipped")
    if not docs:
        print(f"  no artifacts found in {out_dir}")
    finalize(out_dir, docs, args.mode)
    return 0


def _exit_code(args, problems: list[str]) -> int:
    if args.check and problems:
        print(f"\n--check FAILED: {len(problems)} finding(s)", file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="release_dumps.py",
        description="Safe diagnostic dumps for release forensics "
        "(Portal 2.2.1 Cycle 2). Schemas: docs/release/dump-schemas.md",
    )
    sub = ap.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser, *, check: bool = True) -> None:
        p.add_argument(
            "--out",
            default=str(ROOT / "artifacts" / "release"),
            help="output directory for dump artifacts",
        )
        p.add_argument(
            "--mode",
            choices=(SAFE, EXTENDED),
            default=SAFE,
            help="collection depth; extended adds host/CI presence signals "
            "(never values) — secrets stay excluded",
        )
        if check:
            p.add_argument(
                "--check",
                action="store_true",
                help="exit 1 when dumps record findings "
                "(forbidden files, drift, missing required members, errors)",
            )

    p = sub.add_parser("inventory", help="repo/commit/tag/version/workflow dump")
    p.add_argument("--repo-dir", default=str(ROOT), help="repository to inventory")
    common(p)
    p.set_defaults(func=cmd_inventory)

    p = sub.add_parser("vendor", help="vendored portal integrity across forges")
    p.add_argument(
        "--forges-dir",
        default=str(WORKSPACE),
        help="directory holding sibling forge checkouts (default: forjas/ parent)",
    )
    common(p)
    p.set_defaults(func=cmd_vendor)

    p = sub.add_parser("wheel", help="wheel/sdist member + METADATA audit")
    p.add_argument("--artifact", required=True, help="path to .whl/.zip/sdist tarball")
    p.add_argument(
        "--expect-portal",
        action="store_true",
        help="require portal members (index.html, _forge_portal.py, "
        "_portal_telemetry.py) to be present",
    )
    common(p)
    p.set_defaults(func=cmd_wheel)

    p = sub.add_parser("npm", help="npm pack --dry-run file audit")
    p.add_argument(
        "--npm-dir",
        default=str(ROOT),
        help="directory containing package.json (default: this repo)",
    )
    common(p)
    p.set_defaults(func=cmd_npm)

    p = sub.add_parser("all", help="run every collector and emit the full bundle")
    p.add_argument("--repo-dir", default=str(ROOT), help="repository to inventory")
    p.add_argument(
        "--forges-dir",
        default=str(WORKSPACE),
        help="directory holding sibling forge checkouts",
    )
    p.add_argument("--artifact", help="optional wheel/sdist path to audit")
    p.add_argument(
        "--expect-portal",
        action="store_true",
        help="require portal members in --artifact",
    )
    p.add_argument(
        "--npm-dir",
        help="optional package.json directory for the npm pack audit",
    )
    common(p)
    p.set_defaults(func=cmd_all)

    p = sub.add_parser(
        "summarize", help="rebuild release-summary.md + checksums.sha256"
    )
    common(p, check=False)
    p.set_defaults(func=cmd_summarize)

    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.mode == EXTENDED:
        print(
            "WARNING: --mode extended records host/CI presence signals. "
            "Secrets remain excluded, but review artifacts before sharing.",
            file=sys.stderr,
        )
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
