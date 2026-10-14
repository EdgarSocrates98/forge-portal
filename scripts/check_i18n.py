#!/usr/bin/env python3
"""i18n coverage gate — 'zero traduções obrigatórias ausentes'.

Checks, statically (no Angular toolchain required):
  1. key parity between pt-BR and en dictionaries
  2. every literal `'key' | t` used in templates exists in both dicts
  3. dynamic contract keys (installState.*/mcpState.* badge states)
  4. hardcoded prose in templates (text nodes not piped through | t)

Exit 1 on any violation — wired into the repo test suite.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "app"
KEY_RE = re.compile(r"^\s*'([^']+)':", re.MULTILINE)
USE_RE = re.compile(r"'([a-z][\w.-]*)'\s*\|\s*t\b")
PROSE_RE = re.compile(r">([^<>{}\n]*[A-Za-zÀ-ÿ][^<>{}\n]*)<")
CODE_RE = re.compile(r"<code[^>]*>.*?</code>", re.DOTALL)
# data vocabulary allowed untranslated (proper nouns, contract literals)
PROSE_ALLOW = {
    "—", "…", "all", "PT", "EN", "◆", "»", "«", "?", "portal",
    "Ctrl K",  # keyboard chord literal, not prose
    "×", "·",  # glyphs, not prose
    "PowerShell", "bash",  # shell names, contract vocabulary
}

BADGE_CONTRACT_STATES = [
    "VERIFIED", "ACTIVE", "CONFIGURED", "INSTALLED", "DEGRADED", "BLOCKED",
    "NOT_INSTALLED", "FAILED",
]
BADGE_MCP_STATES = [
    "INVOCATION_VERIFIED", "HANDSHAKE_VERIFIED", "TOOLS_DISCOVERED",
    "STARTING", "NOT_CONFIGURED",
]


def dict_keys(path: Path) -> set[str]:
    return set(KEY_RE.findall(path.read_text(encoding="utf-8")))


def main() -> int:
    pt = dict_keys(APP / "core/i18n/locales/pt-br.ts")
    en = dict_keys(APP / "core/i18n/locales/en.ts")
    problems: list[str] = []

    for missing in sorted(pt - en):
        problems.append(f"key in pt-BR missing in en: {missing}")
    for missing in sorted(en - pt):
        problems.append(f"key in en missing in pt-BR: {missing}")

    used: dict[str, list[str]] = {}
    for f in sorted(APP.rglob("*.ts")):
        text = f.read_text(encoding="utf-8")
        for m in USE_RE.finditer(text):
            used.setdefault(m.group(1), []).append(str(f.relative_to(ROOT)))
        tpl = re.search(r"template:\s*`(.*?)`,\n", text, re.DOTALL)
        if tpl:
            # <code>…</code> wraps contract vocabulary (endpoint labels,
            # paths, flags) — technical literals, never prose.
            tpl_body = CODE_RE.sub("", tpl.group(1))
            for hit in PROSE_RE.findall(tpl_body):
                txt = hit.strip()
                if txt and "| t" not in txt and "{{" not in txt and txt not in PROSE_ALLOW:
                    problems.append(
                        f"hardcoded prose in {f.relative_to(ROOT)}: {txt!r}"
                    )

    for key in sorted(set(used) - pt - en):
        problems.append(f"template key absent from both dicts: {key} ({used[key][0]})")

    for state in BADGE_CONTRACT_STATES:
        if f"installState.{state}" not in pt:
            problems.append(f"badge contract key missing: installState.{state}")
    for state in BADGE_MCP_STATES:
        if f"mcpState.{state}" not in pt:
            problems.append(f"badge contract key missing: mcpState.{state}")

    if problems:
        print("i18n coverage FAIL:")
        for p in problems:
            print(f"  {p}")
        return 1
    print(f"i18n coverage ok: {len(pt)} pt-BR keys, {len(en)} en keys, "
          f"{len(set(used))} static keys used")
    return 0


if __name__ == "__main__":
    sys.exit(main())
