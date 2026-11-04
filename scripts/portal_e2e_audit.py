"""Black-box Product Forge Portal audit.

Run against a running Product Forge portal. This intentionally uses only the
public browser surface: it records route availability, console errors,
failed requests, basic accessibility signals, and screenshots without reading
local credential stores or provider secrets.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import Page, sync_playwright


ROUTES = [
    "/dashboard",
    "/install",
    "/config",
    "/forges",
    "/forges/code-atlas-forge",
    "/match",
    "/federation",
    "/profiles",
    "/hosts",
    "/mcp",
    "/skills",
    "/agents",
    "/tasks",
    "/graph",
    "/observe",
    "/execution",
    "/lab",
    "/versions",
    "/knowledge",
    "/guide",
    "/settings",
    "/pf",
    "/pf/products",
    "/pf/boards",
    "/pf/proposals",
    "/pf/settings",
    "/pf/chat",
    "/pf/control-center",
    "/pf/diagnostics",
    "/pf/compare",
    "/pf/lens",
    "/pf/artifacts",
    "/pf/workflows",
    "/pf/templates",
    "/pf/intelligence",
    "/pf/onboarding",
]


def inspect_page(page: Page, route: str, base_url: str, output: Path) -> dict:
    console: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    bad_responses: list[dict[str, str | int]] = []
    page.on("console", lambda msg: console.append({"type": msg.type, "text": msg.text}))
    page.on(
        "requestfailed",
        lambda req: failed.append({"url": req.url, "error": req.failure or "unknown"}),
    )
    page.on(
        "response",
        lambda res: bad_responses.append({"url": res.url, "status": res.status})
        if res.status >= 400
        else None,
    )
    base = urlsplit(base_url)
    query = urlencode(parse_qsl(base.query, keep_blank_values=True))
    target = urlunsplit((base.scheme, base.netloc, route, query, ""))
    response = page.goto(target, wait_until="networkidle", timeout=30_000)
    page.wait_for_timeout(250)
    title = page.title()
    headings = page.locator("h1,h2,h3").all_inner_texts()
    buttons = page.locator("button").count()
    links = page.locator("a").count()
    inputs = page.locator("input,textarea,select").count()
    unnamed_controls = page.locator("button:not([aria-label]):not([title]),input:not([aria-label]):not([id])").count()
    screenshot = output / (route.strip("/").replace("/", "__") or "home")
    screenshot = screenshot.with_suffix(".png")
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        "route": route,
        "url": page.url,
        "status": response.status if response else None,
        "title": title,
        "headings": headings[:12],
        "buttons": buttons,
        "links": links,
        "inputs": inputs,
        "unnamed_controls": unnamed_controls,
        "console_errors": [m for m in console if m["type"] == "error"],
        "console_warnings": [m for m in console if m["type"] == "warning"],
        "failed_requests": failed,
        "bad_responses": bad_responses,
        "screenshot": str(screenshot),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4310/?forge_session=audit")
    parser.add_argument("--output", type=Path, default=Path("audit/portal-e2e-2026-11-04"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        for route in ROUTES:
            try:
                results.append(inspect_page(page, route, args.url, args.output))
            except Exception as exc:  # keep the matrix complete after one route fails
                results.append({"route": route, "status": "NOT_RUN", "error": repr(exc)})
        browser.close()
    report = {
        "base_url": args.url,
        "routes": results,
        "summary": {
            "total": len(results),
            "passed_http": sum(1 for r in results if isinstance(r.get("status"), int) and r["status"] < 400),
            "route_errors": sum(1 for r in results if r.get("status") == "NOT_RUN"),
            "console_error_routes": sum(1 for r in results if r.get("console_errors")),
            "failed_request_routes": sum(1 for r in results if r.get("failed_requests")),
            "bad_response_routes": sum(1 for r in results if r.get("bad_responses")),
        },
    }
    (args.output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))
    for result in results:
        if result.get("status") == "NOT_RUN" or result.get("console_errors") or result.get("failed_requests") or result.get("bad_responses"):
            print(json.dumps(result, ensure_ascii=False))
    return 0 if report["summary"]["route_errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
