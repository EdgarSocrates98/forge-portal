from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "portal_e2e.py"
SPEC = importlib.util.spec_from_file_location("portal_e2e", SCRIPT)
assert SPEC and SPEC.loader
portal_e2e = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(portal_e2e)


def _process(source: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-c", source],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def test_wait_url_skips_logs_before_contract_line() -> None:
    proc = _process(
        "import json, time; print('adapter log', flush=True); "
        "print(json.dumps({'url': 'http://127.0.0.1:1234/?forge_session=test'}), flush=True); "
        "time.sleep(30)"
    )
    try:
        assert portal_e2e.wait_url(proc, timeout=2) == (
            "http://127.0.0.1:1234/?forge_session=test"
        )
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_wait_url_fails_bounded_when_contract_line_never_arrives() -> None:
    proc = _process("import time; print('adapter booting', flush=True); time.sleep(30)")
    try:
        with pytest.raises(RuntimeError, match="did not emit startup URL within 1s"):
            portal_e2e.wait_url(proc, timeout=1)
    finally:
        proc.terminate()
        proc.wait(timeout=5)
