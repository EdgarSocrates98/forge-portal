# registry_ops.py — P1-003: portal registry operations.
#
# Lives OUTSIDE forge_portal.py on purpose: the vendored server keeps its
# "no exec primitives" invariant (tests/test_security_c5.py). This module
# is the only boundary allowed to spawn `forge-cli` — argv arrays, never
# shell — behind plan → confirm → execute with one-time plan tokens.

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import forge_portal as fp

_SAFE_FORGE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

_REGISTRY_ACTIONS: dict[str, list[str]] = {
    "install": ["install", "--method", "registry"],
    "update": ["update", "--method", "registry"],
    "reinstall": ["reinstall", "--method", "registry"],
    "uninstall": ["uninstall", "--method", "registry"],
    "rollback": ["rollback", "--method", "registry"],
    "pin": ["pin", "--method", "registry"],
    "unpin": ["unpin", "--method", "registry"],
    "repair": ["reinstall", "--method", "registry"],
    "verify": ["mcp", "--verify"],
}

# `forge-cli pin|unpin --method registry` has NO `--plan` mode: the CLI
# writes `state.json` unconditionally, so a "plan" subprocess would mutate
# during a read-only phase — breaking the non-mutating contract of
# POST /registry/plan. Their preview is derivable offline from the shared
# registry state (the only thing they touch), so planning never spawns
# the CLI for these actions.
_OFFLINE_PLAN_ACTIONS = frozenset({"pin", "unpin"})


def _cli_binary() -> str | None:
    found = shutil.which("forge-cli")
    if found:
        return found
    shim = Path.home() / ".forge-cli" / "bin" / ("forge-cli.exe" if os.name == "nt" else "forge-cli")
    return str(shim) if shim.is_file() else None


def _run_cli(argv: list[str], timeout: float = 120.0) -> dict[str, Any]:
    """Argv-array subprocess — never shell. Returns parsed JSON doc when the
    CLI's last stdout line is JSON (`--json` mode), else the raw tail."""
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "CLI-TIMEOUT", "detail": f"exceeded {timeout:.0f}s"}
    except OSError as e:
        return {"ok": False, "error": "CLI-SPAWN", "detail": str(e)}
    out = (proc.stdout or "").strip()
    doc: Any = None
    if out:
        try:
            doc = json_loads_last(out)
        except ValueError:
            doc = None
    return {
        "ok": proc.returncode == 0,
        "exit": proc.returncode,
        "doc": doc,
        "stderr": (proc.stderr or "")[-2000:],
    }


def json_loads_last(text: str) -> Any:
    """The CLI may print TUI lines before the JSON doc — parse the last line."""
    import json

    return json.loads(text.splitlines()[-1])


def _offline_plan(action: str, forge: str) -> tuple[dict[str, Any], bool]:
    """Plan preview for actions the CLI cannot plan without mutating
    (pin/unpin — see _OFFLINE_PLAN_ACTIONS). Reads the shared registry
    state only; the second element is whether the op has a target."""
    receipt = fp.read_registry_state().get("forges", {}).get(forge)
    installed = isinstance(receipt, dict)
    preview: dict[str, Any] = {
        "forge": forge,
        "installed": installed,
        "version": receipt.get("version") if installed else None,
        "pinned": receipt.get("pinned") if installed else None,
    }
    if not installed:
        preview["detail"] = "forge is not installed via registry"
    return {"action": action, "forge": forge, "preview": preview}, installed


def _registry_op(ctx: fp.RequestContext, phase: str) -> Any:
    body = ctx.body or {}
    action = str(body.get("action") or "")
    forge = str(body.get("forge") or "")
    argv_head = _REGISTRY_ACTIONS.get(action)
    if argv_head is None:
        raise fp.PortalError(
            "PORTAL-ACTION",
            f"unsupported registry action: {action!r}",
            details={"allowed": sorted(_REGISTRY_ACTIONS)},
        )
    if not _SAFE_FORGE.match(forge):
        raise fp.PortalError("PORTAL-FORGE", f"invalid forge name: {forge!r}")
    cli = _cli_binary()
    if cli is None:
        raise fp.PortalError(
            "PORTAL-CLI-UNAVAILABLE",
            "forge-cli not installed — install it to run registry operations",
            details={"install": "npm i -g theforge-cli"},
            http=409,
        )
    if phase == "plan":
        if action in _OFFLINE_PLAN_ACTIONS:
            plan, ok = _offline_plan(action, forge)
        else:
            res = _run_cli([cli, *argv_head, forge, "--plan", "--json", "--yes"], timeout=60.0)
            plan = {
                "action": action,
                "forge": forge,
                "preview": res.get("doc") or res.get("stderr") or res,
            }
            ok = res["ok"]
        return {
            "status": "planned" if ok else "plan-failed",
            "plan": plan,
            "plan_token": ctx.handler.server.sign_plan(plan),
            "cli": cli,
        }
    # execute — the op contract already demanded confirm + plan_token;
    # here we bind the token to THIS plan and consume it (one-time).
    plan = body.get("plan")
    if not isinstance(plan, dict) or plan.get("action") != action or plan.get("forge") != forge:
        raise fp.PortalError("PORTAL-PLAN-MISMATCH", "plan does not match requested action/forge")
    token = str(body.get("plan_token") or "")
    if not ctx.handler.server.consume_plan(token, plan):
        raise fp.PortalError("PORTAL-PLAN-INVALID", "plan token invalid, expired or already used", http=409)
    res = _run_cli(
        [cli, *argv_head, forge, "--yes", "--json"],
        timeout=300.0 if action == "install" else 180.0,
    )
    return {
        "status": "executed" if res["ok"] else "failed",
        "result": res.get("doc") or {"exit": res.get("exit"), "stderr": res.get("stderr")},
        "state": fp.read_registry_state(),
    }


def registry_operations() -> list[fp.Operation]:
    """Compose into an adapter's ops list: `fp.default_operations(a) + registry_operations()`."""
    return [
        fp.Operation(
            "POST",
            "/registry/plan",
            lambda ctx: _registry_op(ctx, "plan"),
            timeout=90.0,
        ),
        fp.Operation(
            "POST",
            "/registry/execute",
            lambda ctx: _registry_op(ctx, "execute"),
            mutating=True,
            confirm="execute",
            needs_plan_token=True,
            timeout=320.0,
        ),
    ]
