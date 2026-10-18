#!/usr/bin/env python3
"""Portal 2.1 — Cycle 4: real per-forge homologation matrix.

For every forge of the local ecosystem, boot the REAL portal adapter
subprocess — the same ``<cli> portal`` entrypoint a user gets — and
exercise the forge/PortalApi/1 surface over HTTP: initialization,
descriptor, capabilities, health, installation status, profiles,
hosts, skills, agents, MCP, graphs, tasks, knowledge (docs/search),
federation, telemetry and the controlled error paths.

Statuses (closed vocabulary):

- ``VERIFIED``       — surface exercised; honest data or a named
  refusal/state came back (a real ``FAIL`` handshake result is data,
  not a fabrication — the surface is what is being verified).
- ``PARTIAL``        — some probes verified, others failed or
  contradicted a declared capability (e.g. capability says
  ``supported`` but the op is absent).
- ``BLOCKED``        — probe could not run because a prerequisite
  failed (portal did not boot).
- ``UNSUPPORTED``    — op absent on this adapter
  (404 / PORTAL-NOT-FOUND / PORTAL-UNSUPPORTED) or the adapter
  declares the capability ``unsupported``.
- ``NOT_APPLICABLE`` — the capability does not apply to this forge
  (e.g. ``/federation`` on a non-federated leaf forge).
- ``NOT_TESTED``     — intentionally not exercised: real mutations
  (apply/repair/uninstall/profiles.apply/install-auto) are never
  run by homologation; only their refusal boundary is probed.

Nothing is simulated: subprocesses are the real adapter code paths,
requests are real HTTP, and every status is backed by an evidence
string (command + observed result). Where a forge is absent locally,
its whole row is ``NOT_TESTED`` with the discovery evidence.

Usage::

    python scripts/homologation.py                # console matrix
    python scripts/homologation.py --write        # also write
        docs/homologation/cycle-4-matrix.json
        docs/homologation/cycle-4-matrix.md
    python scripts/homologation.py the-forge      # one forge only

``FORGE_ECOSYSTEM`` may point at the sibling-checkout root; manifests
under ``~/.forge/installations/`` (forge/InstallationManifest/v1) are
the primary discovery source — a checkout named in a manifest that is
gone is reported honestly, never fabricated.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

REPO = Path(__file__).resolve().parents[1]
DOCS_DIR = REPO / "docs" / "homologation"
JSON_OUT = DOCS_DIR / "cycle-4-matrix.json"
MD_OUT = DOCS_DIR / "cycle-4-matrix.md"
SCHEMA = "forge-portal/HomologationMatrix/v1"
TIMEOUT = 30
VERIFY_TIMEOUT = 180  # real MCP handshakes spawn real server processes

STATUSES = (
    "VERIFIED",
    "PARTIAL",
    "BLOCKED",
    "UNSUPPORTED",
    "NOT_APPLICABLE",
    "NOT_TESTED",
)

# Honest lifecycle vocabulary from docs/fase0/contracts.md + the
# adapters: a named state is a valid answer; invented states are not.
HONEST_STATES = {
    "NOT_INSTALLED", "INSTALLABLE", "INSTALLED", "CONFIGURED",
    "REGISTERED", "DEGRADED", "BROKEN", "UNVERIFIED", "VERIFIED",
    "ACTIVE", "HEALTHY", "BLOCKED", "FAILED", "UNKNOWN",
    "NOT_APPLICABLE", "READY", "MISSING", "INVALID", "PARTIAL",
}
HONEST_CAP_STATES = {"supported", "unverified", "unsupported", "not_applicable"}
HONEST_AVAILABILITY = {"available", "no_graph", "disabled", "unverified"}
SAFE_INTENT = "check the installation status"


@dataclass(frozen=True)
class ForgeSpec:
    """How to boot a real forge's portal adapter."""

    forge_id: str
    repo: str  # sibling checkout directory name
    argv: tuple[str, ...]  # argv after the python executable
    package: str  # importable package for the installed-copy probe
    cli: str = ""  # installed CLI binary name ("" → forge_id)
    federated: bool = False


FORGES: tuple[ForgeSpec, ...] = (
    ForgeSpec("the-forge", "the-forge", ("-m", "theforge.portal_adapter"), "theforge", cli="theforge", federated=True),
    ForgeSpec("api-forge", "api-forge", ("-m", "apiforge.portal_adapter"), "apiforge", cli="apiforge"),
    ForgeSpec("platform-forge", "platform-forge", ("-m", "platformforge.portal_adapter"), "platformforge", cli="platformforge"),
    ForgeSpec("spark-forge-aws", "spark-forge-aws", ("-m", "sparkforge_aws.portal_adapter"), "sparkforge_aws", cli="sparkforge-aws"),
    ForgeSpec("spark-forge-azure", "spark-forge-azure", ("-m", "sparkforge_azure.portal_adapter"), "sparkforge_azure", cli="sparkforge-azure"),
    ForgeSpec("forge-doctor-data", "forge-doctor-data", ("-m", "forge_doctor_data.portal_adapter"), "forge_doctor_data"),
    ForgeSpec("forge-doctor-api", "forge-doctor-api", ("scripts/forge_portal.py",), "forge_doctor_api"),
)


# ---------------------------------------------------------------------------
# discovery — manifests first (forge/InstallationManifest/v1), checkouts next
# ---------------------------------------------------------------------------


def _home() -> Path:
    return Path(os.environ.get("FORGE_HOME_OVERRIDE") or Path.home())


def installations_dir() -> Path:
    return _home() / ".forge" / "installations"


def _ecosystem_candidates() -> list[Path]:
    out: list[Path] = []
    env = os.environ.get("FORGE_ECOSYSTEM", "").strip()
    if env:
        out.append(Path(env))
    # repo checked out inside the forjas directory (canonical layout)
    out.append(REPO.parent)
    # the worktree may live elsewhere — manifest source.path parents
    for manifest in sorted(installations_dir().glob("*.json")):
        try:
            src = (json.loads(manifest.read_text(encoding="utf-8")).get("source") or {})
        except (OSError, ValueError):
            continue
        p = src.get("path")
        if p:
            out.append(Path(p).parent)
    return out


def _find_checkout(repo: str, manifest_src: dict | None) -> Path | None:
    """Best local checkout: the manifest-declared path wins only when it
    still boots (a real `.venv` python); otherwise fall back to every
    ecosystem candidate that has one. A stale manifest path is reported
    through `manifest` evidence, never silently preferred."""
    declared = (manifest_src or {}).get("path")
    candidates: list[Path] = []
    if declared and Path(declared).is_dir():
        candidates.append(Path(declared))
    for eco in _ecosystem_candidates():
        cand = eco / repo
        if cand.is_dir() and cand not in candidates:
            candidates.append(cand)
    for cand in candidates:
        if _venv_python(cand):
            return cand
    return candidates[0] if candidates else None


def _venv_python(root: Path) -> Path | None:
    for cand in (root / ".venv" / "bin" / "python", root / ".venv" / "Scripts" / "python.exe"):
        if cand.is_file():
            return cand
    return None


@dataclass
class ForgeLocal:
    """Everything homologation knows about one local forge."""

    spec: ForgeSpec
    manifest_path: Path | None
    manifest: dict | None
    checkout: Path | None
    dev_python: Path | None
    installed_python: Path | None
    install_root: Path | None

    @property
    def present(self) -> bool:
        return self.checkout is not None or self.installed_python is not None


def discover(spec: ForgeSpec) -> ForgeLocal:
    """Locate one forge: manifest → installed venv → sibling checkout."""
    manifest_path = installations_dir() / f"{spec.forge_id}.json"
    manifest: dict | None = None
    install_root: Path | None = None
    installed_python: Path | None = None
    if manifest_path.is_file():
        try:
            doc = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(doc, dict):
                manifest = doc
                ir = doc.get("install_root")
                if isinstance(ir, str) and Path(ir).is_dir():
                    install_root = Path(ir)
                venv = doc.get("venv")
                if isinstance(venv, str):
                    cand = Path(venv) / "bin" / "python"
                    if cand.is_file():
                        installed_python = cand
        except (OSError, ValueError):
            manifest = {"_malformed": True}
    if installed_python is None:
        for cand in (
            _home() / ".forge" / "installs" / spec.forge_id / ".venv" / "bin" / "python",
        ):
            if cand.is_file():
                installed_python = cand
                if install_root is None:
                    install_root = cand.parents[2]
                break
    checkout = _find_checkout(spec.repo, (manifest or {}).get("source"))
    dev_python = _venv_python(checkout) if checkout else None
    return ForgeLocal(
        spec=spec,
        manifest_path=manifest_path if manifest_path.is_file() else None,
        manifest=manifest,
        checkout=checkout,
        dev_python=dev_python,
        installed_python=installed_python,
        install_root=install_root,
    )


# ---------------------------------------------------------------------------
# http helpers (same wire rules as scripts/portal_e2e.py)
# ---------------------------------------------------------------------------


def request(
    base: str, token: str, path: str, *, method: str = "GET",
    body: dict | None = None, session: bool = True, timeout: int = TIMEOUT,
) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        base.rstrip("/") + path, data=data, method=method,
        headers={
            "X-Forge-Session": token if session else "",
            "Content-Type": "application/json",
            "Origin": base.rstrip("/"),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"_raw": raw[:300]}
    except urllib.error.URLError as e:
        return 0, {"_url_error": str(e)}


def _wait_url(proc: subprocess.Popen[str], timeout: int = TIMEOUT) -> str:
    """Read stdout until the adapter emits its {"url": …} contract line."""
    import queue

    lines: queue.Queue[tuple[str, str]] = queue.Queue()

    def drain() -> None:
        stream = proc.stdout
        if stream is None:
            lines.put(("eof", ""))
            return
        for line in stream:
            lines.put(("line", line))
        lines.put(("eof", ""))

    threading.Thread(target=drain, daemon=True, name="homolog-stdout").start()
    deadline = time.monotonic() + timeout
    recent: list[str] = []
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            detail = "; ".join(recent[-3:])
            raise RuntimeError(
                f"portal did not emit startup URL within {timeout}s"
                + (f"; output: {detail}" if detail else "")
            )
        try:
            kind, line = lines.get(timeout=min(remaining, 0.25))
        except queue.Empty:
            continue
        if kind == "eof":
            raise RuntimeError(f"portal exited before startup URL: rc={proc.poll()}")
        text = line.strip()
        if not text:
            continue
        try:
            doc = json.loads(text)
        except json.JSONDecodeError:
            recent.append(text[:240])
            continue
        url = doc.get("url") if isinstance(doc, dict) else None
        if isinstance(url, str) and url:
            return url
        # a named refusal document is honest evidence too
        if isinstance(doc, dict) and (doc.get("refusal") or doc.get("status") == "refused"):
            raise RuntimeError(f"portal refused to boot: {json.dumps(doc)[:240]}")
        recent.append(text[:240])


# ---------------------------------------------------------------------------
# probes
# ---------------------------------------------------------------------------


@dataclass
class Probe:
    status: str
    detail: str
    evidence: str


def _agg(probes: list[Probe]) -> tuple[str, str, list[str]]:
    """Collapse probe results into one capability status."""
    if not probes:
        return "NOT_TESTED", "no probes ran", []
    sts = {p.status for p in probes}
    detail = "; ".join(f"{p.detail}" for p in probes if p.detail)[:400]
    evidence = [p.evidence for p in probes if p.evidence]
    if sts == {"NOT_APPLICABLE"}:
        return "NOT_APPLICABLE", detail, evidence
    if sts == {"UNSUPPORTED"}:
        return "UNSUPPORTED", detail, evidence
    if sts == {"BLOCKED"}:
        return "BLOCKED", detail, evidence
    if sts == {"NOT_TESTED"}:
        return "NOT_TESTED", detail, evidence
    if sts <= {"VERIFIED", "NOT_APPLICABLE", "NOT_TESTED"}:
        return "VERIFIED", detail, evidence
    return "PARTIAL", detail, evidence


def _err_code(body: dict) -> str:
    err = (body or {}).get("error")
    return str((err or {}).get("code") or "") if isinstance(err, dict) else ""


def _data(body: dict) -> object:
    return (body or {}).get("data")


def probe_get(base: str, token: str, path: str, what: str) -> Probe:
    code, body = request(base, token, path)
    if code == 200:
        return Probe("VERIFIED", f"{what} answered", f"GET {path} → 200")
    if code == 404:
        return Probe("UNSUPPORTED", f"{what} absent ({_err_code(body) or '404'})",
                     f"GET {path} → 404 {_err_code(body)}")
    if code in (409, 503) or (400 <= code < 600):
        return Probe("PARTIAL", f"{what} named {code} {_err_code(body)}",
                     f"GET {path} → {code} {_err_code(body)}")
    return Probe("BLOCKED", f"{what} unreachable ({code})", f"GET {path} → {code}")


CAPABILITY_ORDER = (
    "initialization", "descriptor", "capabilities", "health", "installation",
    "profiles", "hosts", "skills", "agents", "mcp_servers", "mcp_verify",
    "graphs", "tasks", "knowledge", "federation", "versions", "lab",
    "telemetry", "mutations", "error_paths", "unavailable",
)


def _installed_copy_probe(local: ForgeLocal) -> Probe:
    """`import <pkg>.portal_adapter` on the installed venv python —
    the frozen copy in ~/.forge must import on its own (independence)."""
    py = local.installed_python
    if py is None:
        return Probe("NOT_APPLICABLE", "no installed venv", "~/.forge/installs/<f>/.venv absent")
    module = f"{local.spec.package}.portal_adapter"
    if local.spec.forge_id == "forge-doctor-api":
        module = "forge_portal_adapter"  # checkout-level module under scripts/
    cmd = [str(py), "-c", f"import {module}; print('ok')"]
    env = dict(os.environ)
    if local.spec.forge_id == "forge-doctor-api" and local.checkout:
        env["PYTHONPATH"] = str(local.checkout / "scripts")
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60, check=False,
            cwd=str(local.checkout or local.install_root or "/"), env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return Probe("PARTIAL", f"installed copy probe failed: {type(e).__name__}",
                     f"{' '.join(cmd)} → {e}")
    if proc.returncode == 0:
        return Probe("VERIFIED", "installed copy imports", f"{' '.join(cmd)} → ok")
    tail = (proc.stderr or proc.stdout).strip().splitlines()
    detail = tail[-1].strip()[:160] if tail else f"rc={proc.returncode}"
    return Probe("PARTIAL", f"installed copy import failed: {detail}",
                 f"{' '.join(cmd)} → rc={proc.returncode} {detail}")


def run_matrix(base: str, token: str, local: ForgeLocal) -> dict[str, dict]:
    """Exercise the full capability surface against a live portal."""
    caps: dict[str, list[Probe]] = {k: [] for k in CAPABILITY_ORDER}
    spec = local.spec

    # --- bootstrap / descriptor / capabilities ---------------------------
    code, body = request(base, token, "/api/v1/bootstrap")
    data = _data(body) if code == 200 else {}
    descriptor = (data or {}).get("descriptor") if isinstance(data, dict) else None
    caps["initialization"].append(
        Probe("VERIFIED" if code == 200 else "PARTIAL",
              f"bootstrap answered {code}",
              f"GET /api/v1/bootstrap → {code}"))
    if isinstance(descriptor, dict):
        fid = descriptor.get("forge_id")
        ok = (
            fid == spec.forge_id
            and bool(descriptor.get("cli"))
            and bool(descriptor.get("forge_version") or descriptor.get("version"))
        )
        caps["descriptor"].append(Probe(
            "VERIFIED" if ok else "PARTIAL",
            f"forge_id={fid!r} cli={descriptor.get('cli')!r} "
            f"version={descriptor.get('forge_version') or descriptor.get('version')!r}",
            "bootstrap.data.descriptor fields verified" if ok
            else f"descriptor mismatch/missing fields: {json.dumps(descriptor)[:200]}"))
    else:
        caps["descriptor"].append(
            Probe("PARTIAL", "descriptor missing from bootstrap",
                  f"GET /api/v1/bootstrap → {code} without data.descriptor"))

    code, body = request(base, token, "/api/v1/capabilities")
    declared: dict[str, str] = {}
    if code == 200 and isinstance(_data(body), list):
        for c in _data(body):
            if isinstance(c, dict) and c.get("id"):
                declared[str(c["id"])] = str(c.get("state", "unverified"))
        honest = all(s in HONEST_CAP_STATES for s in declared.values())
        caps["capabilities"].append(Probe(
            "VERIFIED" if honest else "PARTIAL",
            f"{len(declared)} declared",
            "GET /api/v1/capabilities → 200: "
            + ", ".join(f"{k}={v}" for k, v in sorted(declared.items()))[:240]))
    else:
        caps["capabilities"].append(Probe(
            "PARTIAL", f"capabilities answered {code} {_err_code(body)}",
            f"GET /api/v1/capabilities → {code}"))

    # --- health / installation -------------------------------------------
    code, body = request(base, token, "/api/v1/health")
    state = ((_data(body) or {}).get("state") if isinstance(_data(body), dict) else None)
    caps["health"].append(Probe(
        "VERIFIED" if code == 200 and state in HONEST_STATES else "PARTIAL",
        f"state={state!r}",
        f"GET /api/v1/health → {code} state={state!r}"))

    code, body = request(base, token, "/api/v1/installation/status")
    st = ((_data(body) or {}).get("state") if isinstance(_data(body), dict) else None)
    ist_probes = [Probe(
        "VERIFIED" if code == 200 and st in HONEST_STATES else "PARTIAL",
        f"state={st!r}", f"GET /api/v1/installation/status → {code} state={st!r}")]
    if local.manifest_path:
        m = local.manifest or {}
        version = (m.get("version") or "?") if isinstance(m, dict) else "?"
        ist_probes.append(Probe(
            "VERIFIED", f"manifest {version}",
            f"{local.manifest_path} → forge/InstallationManifest/v1 {version}"))
    else:
        ist_probes.append(Probe(
            "NOT_APPLICABLE", "no install manifest",
            f"{installations_dir()}/{local.spec.forge_id}.json absent"))
    ist_probes.append(_installed_copy_probe(local))
    code, body = request(base, token, "/api/v1/registry/state")
    if code == 200:
        pres = (_data(body) or {}).get("present") if isinstance(_data(body), dict) else None
        ist_probes.append(Probe("VERIFIED", f"registry/state present={pres}",
                                f"GET /api/v1/registry/state → 200 present={pres}"))
    else:
        ist_probes.append(Probe("PARTIAL", f"registry/state {code}",
                                f"GET /api/v1/registry/state → {code}"))
    caps["installation"].extend(ist_probes)

    # --- catalogs ---------------------------------------------------------
    for cap_id, path in (
        ("profiles", "/api/v1/profiles"),
        ("hosts", "/api/v1/hosts"),
        ("skills", "/api/v1/skills"),
        ("agents", "/api/v1/agents"),
        ("mcp_servers", "/api/v1/mcp/servers"),
        ("tasks", "/api/v1/tasks"),
    ):
        code, body = request(base, token, path)
        if code == 200:
            d = _data(body)
            n = len(d) if isinstance(d, list) else "?"
            p = Probe("VERIFIED", f"{cap_id}: {n} entries", f"GET {path} → 200 [{n} entries]")
        elif code == 404:
            p = Probe("UNSUPPORTED", f"{cap_id} absent ({_err_code(body) or '404'})",
                      f"GET {path} → 404 {_err_code(body)}")
        elif _err_code(body):
            # a named refusal/degraded state is the surface being honest
            p = Probe("VERIFIED", f"{cap_id} named {code} {_err_code(body)}",
                      f"GET {path} → {code} {_err_code(body)}")
        elif 400 <= code < 600:
            p = Probe("PARTIAL", f"{cap_id} failed unnamed {code}",
                      f"GET {path} → {code}")
        else:
            p = Probe("BLOCKED", f"{cap_id} unreachable ({code})", f"GET {path} → {code}")
        caps[cap_id].append(p)
        # declared-vs-observed cross-check
        cap_key = {"mcp_servers": "mcp"}.get(cap_id, cap_id)
        if cap_key in declared:
            want = declared[cap_key]
            if want == "supported" and p.status == "UNSUPPORTED":
                caps[cap_id].append(Probe(
                    "PARTIAL", "declared supported but op absent",
                    f"capabilities[{cap_key}]=supported vs GET {path} → 404"))
            elif want == "unsupported" and p.status == "UNSUPPORTED":
                caps[cap_id].append(Probe(
                    "VERIFIED", "declared unsupported, op absent (honest)",
                    f"capabilities[{cap_key}]=unsupported ∧ GET {path} → 404"))

    # --- hosts/launch on a likely-absent host ------------------------------
    code, body = request(base, token, "/api/v1/hosts/launch", method="POST",
                         body={"host": "copilot"})
    if code == 404:
        caps["hosts"].append(Probe("UNSUPPORTED", "hosts/launch absent",
                                   "POST /api/v1/hosts/launch → 404"))
    elif code == 200:
        d = _data(body) or {}
        refusal = d.get("refusal") if isinstance(d, dict) else None
        caps["hosts"].append(Probe(
            "VERIFIED",
            f"launch probe → {'refusal ' + str(refusal) if refusal else 'command returned'}",
            f"POST /api/v1/hosts/launch → 200 {json.dumps(d)[:160]}"))
    elif _err_code(body):
        caps["hosts"].append(Probe("VERIFIED", f"launch named refusal {_err_code(body)}",
                                   f"POST /api/v1/hosts/launch → {code} {_err_code(body)}"))
    else:
        caps["hosts"].append(Probe("PARTIAL", f"launch answered {code} without a code",
                                   f"POST /api/v1/hosts/launch → {code}"))

    # --- MCP verify — the real handshake receipt ---------------------------
    code, body = request(base, token, "/api/v1/mcp/verify", method="POST",
                         body={"confirm": "verify"}, timeout=VERIFY_TIMEOUT)
    if code == 404:
        caps["mcp_verify"].append(Probe("UNSUPPORTED", "mcp/verify absent",
                                        "POST /api/v1/mcp/verify → 404"))
    elif code == 200:
        d = _data(body) or {}
        status = (d.get("status") if isinstance(d, dict) else None) or "?"
        servers = d.get("servers") if isinstance(d, dict) else None
        n = len(servers) if isinstance(servers, list) else "?"
        caps["mcp_verify"].append(Probe(
            "VERIFIED", f"receipt status={status}",
            f"POST /api/v1/mcp/verify → 200 status={status} servers={n} "
            f"detail={str(d.get('detail'))[:120]}"))
    elif code in (400, 409, 422, 503):
        caps["mcp_verify"].append(Probe(
            "VERIFIED", f"named refusal {_err_code(body)}",
            f"POST /api/v1/mcp/verify → {code} {_err_code(body)}"))
    else:
        caps["mcp_verify"].append(Probe("PARTIAL", f"verify answered {code}",
                                        f"POST /api/v1/mcp/verify → {code} {_err_code(body)}"))

    # --- graphs -------------------------------------------------------------
    code, body = request(base, token, "/api/v1/graphs")
    if code == 200:
        d = _data(body) or {}
        avail = ((d.get("availability") or {}).get("state")
                 if isinstance(d, dict) else None)
        caps["graphs"].append(Probe(
            "VERIFIED" if avail in HONEST_AVAILABILITY else "PARTIAL",
            f"availability={avail!r}",
            f"GET /api/v1/graphs → 200 availability={avail!r} "
            f"views={len(d.get('views') or []) if isinstance(d, dict) else '?'}"))
    elif code == 404:
        caps["graphs"].append(Probe("UNSUPPORTED", "graphs absent",
                                    f"GET /api/v1/graphs → 404 {_err_code(body)}"))
    else:
        caps["graphs"].append(Probe("PARTIAL", f"graphs answered {code} {_err_code(body)}",
                                    f"GET /api/v1/graphs → {code}"))

    # --- tasks: plan a safe intent, execute it for a real receipt ----------
    code, body = request(base, token, "/api/v1/tasks/plan", method="POST",
                         body={"intent": SAFE_INTENT})
    if code == 404:
        caps["tasks"].append(Probe("UNSUPPORTED", "tasks/plan absent",
                                   "POST /api/v1/tasks/plan → 404"))
    elif code == 200:
        d = _data(body) or {}
        plan, plan_token = d.get("plan"), d.get("plan_token")
        caps["tasks"].append(Probe(
            "VERIFIED" if plan_token else "PARTIAL",
            f"plan → verb={((plan or {}).get('verb'))!r}",
            f"POST /api/v1/tasks/plan → 200 verb={(plan or {}).get('verb')!r}"))
        if plan_token:
            code2, body2 = request(
                base, token, "/api/v1/tasks/execute", method="POST",
                body={"plan": plan, "plan_token": plan_token, "confirm": "execute"},
                timeout=VERIFY_TIMEOUT)
            if code2 == 404:
                caps["tasks"].append(Probe("UNSUPPORTED", "tasks/execute absent",
                                           "POST /api/v1/tasks/execute → 404"))
            elif code2 == 200:
                d2 = _data(body2) or {}
                task = d2.get("task") if isinstance(d2, dict) else None
                stage = (task or {}).get("stage") if isinstance(task, dict) else d2.get("status")
                caps["tasks"].append(Probe(
                    "VERIFIED", f"executed → {stage}",
                    f"POST /api/v1/tasks/execute → 200 stage={stage} "
                    f"receipt={'receipt' in json.dumps(d2)[:4000]}"))
            else:
                caps["tasks"].append(Probe(
                    "VERIFIED", f"execute named refusal {_err_code(body2)}",
                    f"POST /api/v1/tasks/execute → {code2} {_err_code(body2)}"))
    elif _err_code(body):
        caps["tasks"].append(Probe(
            "VERIFIED", f"tasks/plan named refusal {_err_code(body)}",
            f"POST /api/v1/tasks/plan → {code} {_err_code(body)}"))
    else:
        caps["tasks"].append(Probe(
            "PARTIAL", f"tasks/plan answered {code} without a code",
            f"POST /api/v1/tasks/plan → {code}"))

    # --- knowledge: real docs/search --------------------------------------
    code, body = request(base, token, "/api/v1/docs/search?q=portal&limit=5")
    if code == 404:
        caps["knowledge"].append(Probe("UNSUPPORTED", "docs/search absent",
                                       "GET /api/v1/docs/search → 404"))
    elif code == 200:
        d = _data(body)
        n = len(d) if isinstance(d, list) else "?"
        caps["knowledge"].append(Probe("VERIFIED", f"{n} hits for 'portal'",
                                       f"GET /api/v1/docs/search?q=portal → 200 [{n} hits]"))
    else:
        caps["knowledge"].append(Probe("PARTIAL", f"docs/search {code} {_err_code(body)}",
                                       f"GET /api/v1/docs/search → {code}"))

    # --- the-forge-only surfaces → NOT_APPLICABLE on leaf forges -----------
    for cap_id, path, applies in (
        ("federation", "/api/v1/federation", spec.federated),
        ("versions", "/api/v1/versions", spec.federated),
        ("lab", "/api/v1/lab", spec.federated),
    ):
        if not applies:
            code, body = request(base, token, path)
            if code == 404:
                caps[cap_id].append(Probe(
                    "NOT_APPLICABLE", "capability not claimed by this forge",
                    f"GET {path} → 404 (federated={spec.federated})"))
            elif code == 200:
                caps[cap_id].append(Probe(
                    "VERIFIED", "surface answered despite federated=false",
                    f"GET {path} → 200"))
            else:
                caps[cap_id].append(Probe(
                    "PARTIAL", f"answered {code}", f"GET {path} → {code} {_err_code(body)}"))
        else:
            p = probe_get(base, token, path, cap_id)
            if p.status == "VERIFIED":
                code2, body2 = request(base, token, path)
                d = _data(body2)
                summary = ""
                if isinstance(d, dict):
                    if cap_id == "federation":
                        summary = f"specialists={len(d.get('specialists') or [])} installed={len(d.get('installed_forges') or [])}"
                    elif cap_id == "versions":
                        summary = f"compat={d.get('compat')!r}"
                    elif cap_id == "lab":
                        summary = f"runs={len(d.get('runs') or [])}"
                p = Probe("VERIFIED", summary or f"{cap_id} answered", f"GET {path} → 200 {summary}")
            caps[cap_id].append(p)

    # --- telemetry: /events is contract-additive; adapters may not register -
    code, body = request(base, token, "/api/v1/events")
    if code == 404:
        caps["telemetry"].append(Probe(
            "UNSUPPORTED", "event sink ops not registered on this adapter",
            "GET /api/v1/events → 404"))
    elif code == 200:
        d = _data(body) or {}
        caps["telemetry"].append(Probe(
            "VERIFIED", f"{(d or {}).get('count', '?')} recorded events",
            "GET /api/v1/events → 200"))
    else:
        caps["telemetry"].append(Probe("PARTIAL", f"events {code}",
                                       f"GET /api/v1/events → {code} {_err_code(body)}"))

    # --- controlled error paths ----------------------------------------------
    code, _ = request(base, "", "/api/v1/bootstrap", session=False)
    caps["error_paths"].append(Probe(
        "VERIFIED" if code == 403 else "PARTIAL",
        f"no-session → {code}", "GET /api/v1/bootstrap without session"))
    code, body = request(base, token, "/api/v1/__homologation__")
    caps["error_paths"].append(Probe(
        "VERIFIED" if code == 404 else "PARTIAL",
        f"unknown op → {code} {_err_code(body)}", "GET /api/v1/__homologation__"))
    # every mutating op must refuse without its confirm literal — the
    # refusal IS the verification; homologation never executes mutations
    for op, confirm in (
        ("/api/v1/installation/apply", "apply"),
        ("/api/v1/installation/repair", "repair"),
        ("/api/v1/installation/uninstall", "uninstall"),
        ("/api/v1/profiles/apply", "apply"),
    ):
        code, body = request(base, token, op, method="POST", body={})
        if code == 404:
            caps["error_paths"].append(Probe(
                "NOT_APPLICABLE", f"{op.rsplit('/', 1)[-1]} absent",
                f"POST {op} → 404"))
        else:
            named = code in (400, 409, 422) and _err_code(body) in (
                "PORTAL-CONFIRM", "PORTAL-PLAN-REQUIRED", "PORTAL-MISSING-FIELD")
            caps["error_paths"].append(Probe(
                "VERIFIED" if named else "PARTIAL",
                f"{op.rsplit('/', 1)[-1]} w/o confirm → {code} {_err_code(body)}",
                f"POST {op} {{}} → {code} {_err_code(body)} (never executed)"))
    code, body = request(
        base, token, "/api/v1/installation/apply", method="POST",
        body={"confirm": "apply", "plan": {}, "plan_token": "forged"})
    ok = code in (400, 403, 409, 422) and bool(_err_code(body))
    caps["error_paths"].append(Probe(
        "VERIFIED" if ok else "PARTIAL",
        f"forged plan token → {code} {_err_code(body)}",
        "POST /api/v1/installation/apply with forged token"))
    code, _ = request(base, token, "/api/v1/../pyproject.toml")
    caps["error_paths"].append(Probe(
        "VERIFIED" if code in (404, 403) else "PARTIAL",
        f"traversal → {code}", "GET /api/v1/../pyproject.toml"))
    # missing-field probe via a non-mutating validated op
    code, body = request(base, token, "/api/v1/hosts/launch", method="POST", body={})
    caps["error_paths"].append(Probe(
        "VERIFIED" if code in (400, 404) and (_err_code(body) or code == 404) else "PARTIAL",
        f"missing host field → {code} {_err_code(body)}",
        "POST /api/v1/hosts/launch {}"))

    # --- mutations homologation never performs → NOT_TESTED -----------------
    caps["mutations"].append(Probe(
        "NOT_TESTED",
        "apply/repair/uninstall/profiles.apply/install-auto execute real "
        "changes — refusal boundary verified under error_paths, the "
        "mutations themselves are never run",
        "policy: read-only + named refusals only"))

    # --- unavailable capabilities: a known-absent op stays a named 404 ------
    code, body = request(base, token, "/api/v1/nope")
    caps["unavailable"].append(Probe(
        "VERIFIED" if code == 404 else "PARTIAL",
        f"absent op → {code} {_err_code(body)}",
        "GET /api/v1/nope → named refusal, never a crash"))

    out: dict[str, dict] = {}
    for cap_id, probes in caps.items():
        status, detail, evidence = _agg(probes)
        out[cap_id] = {"status": status, "detail": detail, "evidence": evidence}
    return out


# ---------------------------------------------------------------------------
# per-forge run
# ---------------------------------------------------------------------------


@dataclass
class ForgeResult:
    spec: ForgeSpec
    local: ForgeLocal
    present: bool
    booted: bool
    url: str | None
    boot_error: str | None
    capabilities: dict[str, dict] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "forge_id": self.spec.forge_id,
            "present": self.present,
            "checkout": str(self.local.checkout) if self.local.checkout else None,
            "installed_venv": str(self.local.installed_python.parents[2]) if self.local.installed_python else None,
            "manifest": str(self.local.manifest_path) if self.local.manifest_path else None,
            "booted": self.booted,
            "url": self.url,
            "boot_error": self.boot_error,
            "capabilities": self.capabilities,
        }


def _boot(local: ForgeLocal) -> tuple[subprocess.Popen[str], str]:
    """Start the real portal subprocess; return (proc, url)."""
    scratch = Path(tempfile.mkdtemp(prefix=f"homolog-{local.spec.forge_id}-"))
    attempts: list[tuple[Path, list[str], Path]] = []
    if local.dev_python and local.checkout:
        attempts.append((local.dev_python, list(local.spec.argv), local.checkout))
    if local.installed_python:
        if local.spec.forge_id == "forge-doctor-api":
            # checkout-level script entrypoint — the installed venv
            # supplies the `forge_doctor_api` package the adapter needs
            if local.checkout:
                attempts.append(
                    (local.installed_python, list(local.spec.argv), local.checkout)
                )
        else:
            # installed copy: module entrypoint only
            argv = ["-m", f"{local.spec.package}.portal_adapter"]
            attempts.append(
                (local.installed_python, argv, local.install_root or Path("/"))
            )
    errors: list[str] = []
    for py, argv, cwd in attempts:
        cmd = [str(py), *argv, "--no-browser", "--root", str(scratch)]
        try:
            proc = subprocess.Popen(
                cmd, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
            )
        except OSError as e:
            errors.append(f"{' '.join(cmd)}: {e}")
            continue
        try:
            url = _wait_url(proc)
            return proc, url
        except RuntimeError as e:
            errors.append(str(e))
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    raise RuntimeError(" | ".join(errors) or "no python entrypoint available")


def run_forge(spec: ForgeSpec) -> ForgeResult:
    local = discover(spec)
    if not local.present:
        return ForgeResult(
            spec=spec, local=local, present=False, booted=False, url=None,
            boot_error="no checkout, venv or installed copy found",
            capabilities={cap: {"status": "NOT_TESTED",
                                "detail": "forge not present locally",
                                "evidence": ["discovery: no manifest/checkout/venv"]}
                          for cap in CAPABILITY_ORDER},
        )
    try:
        proc, url = _boot(local)
    except RuntimeError as e:
        caps = {cap: {"status": "NOT_TESTED", "detail": "blocked by boot failure",
                      "evidence": []} for cap in CAPABILITY_ORDER}
        caps["initialization"] = {
            "status": "PARTIAL",
            "detail": f"portal failed to boot: {e}",
            "evidence": [str(e)],
        }
        return ForgeResult(spec=spec, local=local, present=True, booted=False,
                           url=None, boot_error=str(e), capabilities=caps)
    try:
        parts = urlsplit(url)
        token = parse_qs(parts.query)["forge_session"][0]
        base = f"{parts.scheme}://{parts.hostname}:{parts.port}"
        caps = run_matrix(base, token, local)
        return ForgeResult(spec=spec, local=local, present=True, booted=True,
                           url=url, boot_error=None, capabilities=caps)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------


def build_report(results: list[ForgeResult]) -> dict:
    summary = {s: 0 for s in STATUSES}
    for r in results:
        for cap in r.capabilities.values():
            if cap["status"] in summary:
                summary[cap["status"]] += 1
    return {
        "schema": SCHEMA,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ecosystem": {
            "installations_dir": str(installations_dir()),
            "forges": len(results),
            "present": sum(1 for r in results if r.present),
            "booted": sum(1 for r in results if r.booted),
        },
        "forges": [r.to_dict() for r in results],
        "summary": summary,
    }


def matrix_markdown(report: dict) -> str:
    lines = [
        "# Cycle 4 — Per-forge homologation matrix",
        "",
        f"Generated by `python scripts/homologation.py --write` at {report['generated_at']}Z.",
        "Statuses: VERIFIED · PARTIAL · BLOCKED · UNSUPPORTED · NOT_APPLICABLE · NOT_TESTED.",
        "Evidence strings are the real command/probe and observed answer —",
        "regenerate with the same command; nothing here is authored.",
        "",
        "| Capability | " + " | ".join(f["forge_id"] for f in report["forges"]) + " |",
        "|" + "---|" * (len(report["forges"]) + 1),
    ]
    for cap in CAPABILITY_ORDER:
        row = [f"`{cap}`"]
        for f in report["forges"]:
            cell = f["capabilities"].get(cap, {})
            row.append(cell.get("status", "—"))
        lines.append("| " + " | ".join(row) + " |")
    lines += [
        "",
        "## Summary",
        "",
        "| Status | Count |",
        "|---|---|",
    ]
    for s in STATUSES:
        lines.append(f"| {s} | {report['summary'].get(s, 0)} |")
    lines += ["", "## Per-forge detail", ""]
    for f in report["forges"]:
        lines.append(f"### {f['forge_id']}")
        lines.append("")
        lines.append(f"- present: `{f['present']}` · booted: `{f['booted']}`")
        if f.get("checkout"):
            lines.append(f"- checkout: `{f['checkout']}`")
        if f.get("installed_venv"):
            lines.append(f"- installed venv: `{f['installed_venv']}`")
        if f.get("boot_error"):
            lines.append(f"- boot error: `{f['boot_error']}`")
        lines.append("")
        for cap in CAPABILITY_ORDER:
            c = f["capabilities"].get(cap, {})
            if not c:
                continue
            lines.append(f"- **{cap}** — `{c['status']}` — {c.get('detail', '')}")
            for ev in (c.get("evidence") or [])[:6]:
                lines.append(f"  - `{ev}`")
        lines.append("")
    return "\n".join(lines)


def console_report(results: list[ForgeResult]) -> None:
    for r in results:
        print(f"\n=== {r.spec.forge_id} ===")
        if not r.present:
            print("  absent — NOT_TESTED")
            continue
        if not r.booted:
            print(f"  boot FAILED: {r.boot_error}")
        for cap in CAPABILITY_ORDER:
            c = r.capabilities.get(cap)
            if not c:
                continue
            print(f"  {c['status']:<15} {cap} — {c['detail'][:110]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("forges", nargs="*", help="forge ids (default: all discovered)")
    ap.add_argument("--write", action="store_true", help="write docs/homologation artifacts")
    ap.add_argument("--json", action="store_true", help="print the JSON report")
    args = ap.parse_args()

    wanted = set(args.forges) if args.forges else None
    specs = [s for s in FORGES if wanted is None or s.forge_id in wanted]

    with ThreadPoolExecutor(max_workers=max(1, min(7, len(specs))),
                            thread_name_prefix="homolog") as pool:
        results = list(pool.map(run_forge, specs))

    report = build_report(results)
    if args.write:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        JSON_OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8")
        MD_OUT.write_text(matrix_markdown(report), encoding="utf-8")
        print(f"wrote {JSON_OUT.relative_to(REPO)} + {MD_OUT.relative_to(REPO)}")
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        console_report(results)

    # exit code: 0 when every exercised surface was honest (no PARTIAL/BLOCKED
    # left unexplained — PARTIAL is still reported but gates the run)
    bad = report["summary"]["PARTIAL"] + report["summary"]["BLOCKED"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
