#!/usr/bin/env python3
"""Browser visual/axe gate for the Product Forge Knowledge deep-link.

The Portal shell is served by the real local PortalServer and real production
bundle. Product Forge responses are intercepted at the browser boundary with
typed ``forge/PortalApi/1`` envelopes so the gate remains deterministic and
does not need credentials or a running Product Forge process.

Run after ``npm run build``::

    python e2e/pf_knowledge_visual_gate.py --out .audit-work/pf-knowledge
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "portal_core"))
sys.path.insert(0, str(REPO / "e2e"))

import forge_portal as fp
from playwright.sync_api import Page, Route, sync_playwright
from test_browser_e2e import E2EAdapter

BUNDLE = REPO / "dist" / "forge-portal-app" / "browser"
AXE = REPO / "node_modules" / "axe-core" / "axe.min.js"
PRODUCT = "pf-demo"
ROUTE = f"/pf/products/{PRODUCT}?tab=knowledge"
VIEWPORTS = ((1920, 1080), (1366, 768), (768, 1024), (390, 844))
THEMES = ("dark", "light")


def envelope(data: Any) -> dict[str, Any]:
    return {"schema": "forge/PortalApi/1", "correlation_id": "e2e-pf", "data": data}


def product() -> dict[str, Any]:
    return {
        "id": PRODUCT,
        "workspace_id": "ws-e2e",
        "name": "Knowledge Gate Product",
        "description": "Deterministic deep-link visual fixture",
        "domain": "data-platform",
        "status": "active",
    }


def pf_payload(path: str, method: str) -> Any:
    if path == f"/products/{PRODUCT}":
        return product()
    if path.endswith("/documents/url/preview"):
        return {
            "schema": "productforge/UrlDocument/v1",
            "url": "https://docs.example.com/runbook",
            "title": "Defuddle runbook preview",
            "preview": "# Defuddle runbook\n\nValidated HTML preview for the visual gate.",
            "content_hash": "sha256:e2e",
            "size": 256,
            "content_type": "text/html",
            "extractor": "defuddle-cli",
            "state": "ready_for_import",
            "warnings": ["validated local HTML"],
            "metrics": {"bytes_read": 256, "characters": 58},
            "provenance": {"requested_url": "https://docs.example.com/runbook"},
        }
    if path.endswith("/documents/from-url") and method == "POST":
        return {
            "id": "doc-e2e",
            "product_id": PRODUCT,
            "title": "Defuddle runbook preview",
            "status": "indexed",
            "chunk_count": 1,
            "state": "imported",
            "source_url": "https://docs.example.com/runbook",
            "source_kind": "url",
        }
    if path.endswith("/documents/obsidian/preview"):
        return {
            "schema": "productforge/ObsidianDocument/v1",
            "path": "runbooks/spark-diagnosis.md",
            "title": "Spark diagnosis runbook",
            "preview": "# Spark diagnosis\n\nValidated Obsidian vault preview.",
            "content_hash": "sha256:obsidian-e2e",
            "size": 52,
            "state": "ready_for_import",
            "provenance": {"adapter": "stdlib-obsidian-markdown", "cli_required": False},
        }
    if path.endswith("/documents/from-obsidian") and method == "POST":
        return {
            "id": "doc-obsidian-e2e",
            "product_id": PRODUCT,
            "title": "Spark diagnosis runbook",
            "status": "indexed",
            "chunk_count": 2,
            "state": "imported",
            "source_path": "runbooks/spark-diagnosis.md",
            "source_kind": "obsidian",
        }
    if path.endswith("/documents"):
        return {
            "items": [
                {
                    "id": "doc-1",
                    "product_id": PRODUCT,
                    "title": "Spark runbook",
                    "status": "indexed",
                    "chunk_count": 3,
                }
            ]
        }
    if path.endswith("/sources"):
        return {
            "items": [
                {"id": "src-1", "product_id": PRODUCT, "name": "Runbooks", "type": "url", "status": "indexed"}
            ]
        }
    if path.endswith("/knowledge-health"):
        return {
            "score": 0.92,
            "sources": {"indexed": 1, "total": 1},
            "entities": {"total": 4},
            "warnings": [],
        }
    if path.endswith("/graph"):
        return {"nodes": [], "edges": [], "stats": {"nodes": 4, "edges": 2}}
    return {"items": []}


def intercept(route: Route) -> None:
    request = route.request
    path = request.url.split("/api/v1", 1)[-1].split("?", 1)[0]
    route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(envelope(pf_payload(path, request.method)), ensure_ascii=False),
    )


def focus_without_ring(page: Page) -> int:
    bad = 0
    for _ in range(14):
        page.keyboard.press("Tab")
        focused = page.evaluate(
            """() => {
              const el = document.activeElement;
              if (!el) return null;
              const st = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return {
                visible: r.width > 0 && r.height > 0,
                outline: `${st.outlineStyle} ${st.outlineWidth}`,
                shadow: st.boxShadow !== 'none',
              };
            }"""
        )
        if (
            focused
            and focused["visible"]
            and not focused["shadow"]
            and focused["outline"]
            in {
                "none 0px",
                "none medium",
            }
        ):
            bad += 1
    return bad


def gate_page(page: Page, base: str, token: str, theme: str, width: int, height: int) -> dict[str, Any]:
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"{base}{ROUTE}&forge_session={token}")
    page.wait_for_load_state("networkidle")
    # The product defaults to pt-BR; this gate's interaction labels are
    # English, so pin the fixture locale before the first stable render.
    page.evaluate("localStorage.setItem('forge-portal.locale', 'en')")
    page.evaluate(f"localStorage.setItem('forge-portal.scheme', '{theme}')")
    page.reload()
    page.wait_for_load_state("networkidle")
    # Portal CSP blocks inline script tags; evaluating the vetted local axe
    # bundle mirrors the existing visual probe without weakening the policy.
    page.evaluate(AXE.read_text(encoding="utf-8"))
    try:
        page.get_by_text("Capture a knowledge source", exact=True).wait_for()
    except Exception:
        print(f"Product Forge gate did not render: url={page.url} title={page.title()}")
        print(page.locator("body").inner_text()[:2000])
        raise
    page.wait_for_timeout(250)

    axe = page.evaluate("""async () => (await axe.run(document, {resultTypes: ['violations']})).violations""")
    axe_summary = [
        {"id": item["id"], "impact": item["impact"], "nodes": [n["target"] for n in item["nodes"][:4]]}
        for item in axe
    ]
    overflow = page.evaluate("""() => document.documentElement.scrollWidth > window.innerWidth""")
    focus_bad = focus_without_ring(page)
    page.get_by_role("button", name="Public URL").click()
    page.get_by_label("Public document URL").fill("https://docs.example.com/runbook")
    page.get_by_label("Extraction engine").select_option("defuddle")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Fetch and preview").click()
    page.get_by_text("Defuddle runbook preview", exact=False).wait_for()
    selected = page.get_by_label("Extraction engine").input_value()
    preview_axe = page.evaluate(
        """async () => (await axe.run(document, {resultTypes: ['violations']})).violations"""
    )
    html_preview_visible = page.get_by_text(
        "Validated HTML preview for the visual gate.", exact=False
    ).is_visible()
    page.get_by_role("button", name="Obsidian vault").click()
    page.get_by_label("Vault path").fill("runbooks/spark-diagnosis.md")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Preview from Obsidian").click()
    page.get_by_text("Spark diagnosis runbook", exact=False).wait_for()
    obsidian_preview_visible = page.get_by_text(
        "Validated Obsidian vault preview.", exact=False
    ).is_visible()
    return {
        "theme": theme,
        "viewport": f"{width}x{height}",
        "axe": axe_summary,
        "preview_axe": [{"id": v["id"], "impact": v["impact"]} for v in preview_axe],
        "horizontal_overflow": bool(overflow),
        "focus_without_ring": focus_bad,
        "defuddle_selected": selected == "defuddle",
        "preview_visible": html_preview_visible,
        "obsidian_preview_visible": obsidian_preview_visible,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=REPO / ".audit-work" / "pf-knowledge")
    args = parser.parse_args(argv)
    if not BUNDLE.is_dir():
        parser.error("dist/forge-portal-app/browser is missing; run npm run build first")
    if not AXE.is_file():
        parser.error("node_modules/axe-core/axe.min.js is missing; run npm install")
    args.out.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    server = fp.PortalServer(E2EAdapter(), quiet=True)
    server.serve_in_thread()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page()
            page.route(f"**/api/v1/products/{PRODUCT}**", intercept)
            for theme in THEMES:
                for width, height in VIEWPORTS:
                    result = gate_page(
                        page,
                        f"http://127.0.0.1:{server.port}",
                        server.session_token,
                        theme,
                        width,
                        height,
                    )
                    page.screenshot(path=str(args.out / f"{theme}-{width}x{height}.png"), full_page=True)
                    results.append(result)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    report = {
        "schema": "forge-portal/pf-knowledge-visual-gate/v1",
        "route": ROUTE,
        "cases": len(results),
        "results": results,
        "axe_violations": sum(len(row["axe"]) + len(row["preview_axe"]) for row in results),
        "serious_or_critical": sum(
            1
            for row in results
            for item in row["axe"] + row["preview_axe"]
            if item.get("impact") in {"serious", "critical"}
        ),
        "overflow_cases": sum(1 for row in results if row["horizontal_overflow"]),
        "focus_without_ring": sum(row["focus_without_ring"] for row in results),
        "defuddle_selection_failures": sum(1 for row in results if not row["defuddle_selected"]),
        "preview_failures": sum(1 for row in results if not row["preview_visible"]),
        "obsidian_preview_failures": sum(
            1 for row in results if not row["obsidian_preview_visible"]
        ),
    }
    report["status"] = (
        "PASS"
        if all(
            report[key] == 0
            for key in (
                "axe_violations",
                "serious_or_critical",
                "overflow_cases",
                "focus_without_ring",
                "defuddle_selection_failures",
                "preview_failures",
                "obsidian_preview_failures",
            )
        )
        and report["cases"] == 8
        else "FAIL"
    )
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "schema",
                    "route",
                    "cases",
                    "axe_violations",
                    "serious_or_critical",
                    "overflow_cases",
                    "focus_without_ring",
                    "defuddle_selection_failures",
                    "preview_failures",
                    "obsidian_preview_failures",
                    "status",
                )
            },
            indent=2,
        )
    )
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
