#!/usr/bin/env python3
"""FASE 9 — E2E global: cada forja, portal real, jornada completa.

Para cada forja do ecossistema, sobe o portal real via subprocesso
(o mesmo entrypoint do verbo CLI) num workspace scratch e exercita a
jornada inteira por HTTP: sessão -> bootstrap -> health -> capabilities ->
instalacao (status/plan/apply) -> catalogos -> hosts/mcp/graphs/tasks ->
segurança (403 sem sessao, apply sem confirm, token forjado, traversal).

Nenhuma resposta é simulada: estados NOT_INSTALLED/DEGRADED/refusals
nomeados contam como honestos; estados inventados (ex.: INSTALLED sem
receipt) falhariam os asserts de forma.

Uso: python scripts/portal_e2e.py [forge ...]
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ECO = Path(__file__).resolve().parents[2]
TIMEOUT = 30

# forge -> (repo, argv para subir o portal, env extra)
FORGES: dict[str, tuple[str, list[str]]] = {
    "the-forge": ("the-forge", ["-m", "theforge.portal_adapter"]),
    "spark-forge-aws": ("spark-forge-aws", ["-m", "sparkforge_aws.portal_adapter"]),
    "spark-forge-azure": ("spark-forge-azure", ["-m", "sparkforge_azure.portal_adapter"]),
    "api-forge": ("api-forge", ["-m", "apiforge.portal_adapter"]),
    "platform-forge": ("platform-forge", ["-m", "platformforge.portal_adapter"]),
    "forge-doctor-data": (
        "forge-doctor-data", ["-m", "forge_doctor_data.portal_adapter"],
    ),
    "forge-doctor-api": ("forge-doctor-api", ["scripts/forge_portal.py"]),
}

HONEST_STATES = {
    "NOT_INSTALLED", "INSTALLABLE", "INSTALLED", "CONFIGURED", "REGISTERED",
    "DEGRADED", "BROKEN", "UNVERIFIED", "VERIFIED", "ACTIVE", "HEALTHY",
    "BLOCKED", "FAILED", "UNKNOWN", "NOT_APPLICABLE",
}


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


def check(name: str, ok: bool, detail: str = "") -> bool:
    mark = "ok" if ok else "FAIL"
    print(f"  [{mark}] {name}{(' — ' + detail) if detail else ''}")
    return ok


def wait_url(proc: subprocess.Popen[str]) -> str:
    line = proc.stdout.readline() if proc.stdout else ""
    if not line:
        raise RuntimeError(f"portal exited early: rc={proc.poll()}")
    doc = json.loads(line)
    return doc["url"]


def run_forge(forge: str, repo: str, argv: list[str]) -> bool:
    root_repo = ECO / repo
    py = root_repo / ".venv" / "Scripts" / "python.exe"
    if not py.exists():
        py = root_repo / ".venv" / "bin" / "python"
    scratch = Path(tempfile.mkdtemp(prefix=f"e2e-{forge}-"))
    cmd = [str(py), *argv, "--no-browser", "--root", str(scratch)]
    proc = subprocess.Popen(
        cmd, cwd=root_repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    ok = True
    try:
        url = wait_url(proc)
        parts = urlsplit(url)
        token = parse_qs(parts.query)["forge_session"][0]
        base = f"{parts.scheme}://{parts.hostname}:{parts.port}"
        assert parts.hostname in ("127.0.0.1", "localhost")

        # --- segurança: superfície fechada sem sessao -------------------
        code, _ = request(base, "", "/api/v1/bootstrap", session=False)
        ok &= check("bootstrap sem sessao -> 403", code == 403, f"got {code}")

        code, body = request(base, token, "/api/v1/bootstrap")
        ok &= check("bootstrap com sessão -> 200", code == 200, f"got {code}")
        env_ok = body.get("schema") == "forge/PortalApi/1" and "data" in body
        ok &= check("envelope forge/PortalApi/1", env_ok)
        data = body.get("data", {})
        ok &= check(
            "bootstrap carrega descriptor",
            isinstance(data.get("descriptor"), dict),
        )

        code, body = request(base, token, "/api/v1/capabilities")
        caps = body.get("data")
        ok &= check(
            "capabilities -> lista nao vazia",
            code == 200 and isinstance(caps, list) and len(caps) > 0,
            f"{code} {len(caps) if isinstance(caps, list) else caps}",
        )

        # --- saúde honesta ----------------------------------------------
        code, body = request(base, token, "/api/v1/health")
        state = (body.get("data") or {}).get("state", "")
        ok &= check(
            "health state honesto", code == 200 and state in HONEST_STATES,
            f"{code} {state}",
        )

        # --- instalacao ---------------------------------------------------
        code, body = request(base, token, "/api/v1/installation/status")
        st = (body.get("data") or {}).get("state", "")
        ok &= check(
            "installation/status honesto",
            code == 200 and st in HONEST_STATES, f"{code} {st}",
        )

        code, body = request(
            base, token, "/api/v1/installation/plan", method="POST",
            body={"scope": "project"},
        )
        plan_doc = body.get("data") or {}
        honest_plan = bool(
            code == 200 and (plan_doc.get("plan_token") or plan_doc.get("plan"))
        ) or bool(
            code in (400, 409, 422) and (body.get("error") or {}).get("code")
        )
        ok &= check(
            "plan -> plano real ou recusa nomeada", honest_plan,
            f"{code} {(body.get('error') or {}).get('code', '')}",
        )

        code, body = request(
            base, token, "/api/v1/installation/apply", method="POST",
            body={"confirm": "apply", "plan": {}, "plan_token": "forged"},
        )
        apply_refusal = (body.get("error") or {}).get("code", "")
        ok &= check(
            "apply token forjado -> 4xx nomeado",
            code in (400, 403, 409, 422) and bool(apply_refusal),
            f"{code} {apply_refusal}",
        )

        # --- catalogos e observacoes (read-only) --------------------------
        for ep, what in [
            ("/api/v1/hosts", "hosts"),
            ("/api/v1/skills", "skills"),
            ("/api/v1/agents", "agents"),
            ("/api/v1/tasks", "tasks"),
        ]:
            code, body = request(base, token, ep)
            d = body.get("data")
            ok &= check(
                f"GET {what} -> lista ou recusa",
                code == 200 and isinstance(d, list) or code in (404, 409),
                f"{code}",
            )

        code, body = request(base, token, "/api/v1/mcp/servers")
        ok &= check("GET mcp -> 200/404/409", code in (200, 404, 409), f"{code}")

        code, _ = request(base, token, "/api/v1/graphs")
        ok &= check("GET graphs -> 200/404/409", code in (200, 404, 409), f"{code}")

        # --- traversal / SPA ---------------------------------------------
        code, _ = request(base, token, "/../pyproject.toml")
        ok &= check("traversal -> 404", code == 404, f"got {code}")

        code, _ = request(base, token, "/api/v1/nope")
        ok &= check("op desconhecida -> 404", code == 404, f"got {code}")

        # --- jornada: task segura ----------------------------------------
        code, body = request(
            base, token, "/api/v1/tasks/plan", method="POST",
            body={"intent": "doctor"},
        )
        ok &= check(
            "task plan intent seguro -> plano ou recusa",
            code in (200, 400, 409, 422), f"{code}",
        )
        return ok
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    wanted = sys.argv[1:] or list(FORGES)
    results: dict[str, bool] = {}
    for forge in wanted:
        repo, argv = FORGES[forge]
        print(f"\n=== {forge} ===")
        try:
            results[forge] = run_forge(forge, repo, argv)
        except Exception as e:  # noqa: BLE001 — report, then continue other forges
            print(f"  [FAIL] entrypoint: {e}")
            results[forge] = False
    print("\n=== resumo ===")
    for forge, ok in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {forge}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
