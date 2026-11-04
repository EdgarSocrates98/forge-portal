"""Black-box chat journey for the Product Forge Portal.

Uses the deterministic fake Bridge provider for the turn itself. Real hosts
are still discovered and displayed, but this test never sends a paid or
external prompt and never reads credential stores.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", default="audit/portal-chat-2026-11-04.json")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    console_errors: list[str] = []
    failed_requests: list[dict[str, str]] = []
    bad_responses: list[dict[str, object]] = []
    result: dict[str, object] = {"url": args.url, "status": "NOT_RUN"}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("requestfailed", lambda req: failed_requests.append({"url": req.url, "error": req.failure or "unknown"}))
        page.on(
            "response",
            lambda res: bad_responses.append({"url": res.url, "status": res.status})
            if res.status >= 400
            else None,
        )

        base = urlsplit(args.url)
        chat_url = urlunsplit((base.scheme, base.netloc, "/pf/chat", base.query, base.fragment))
        page.goto(chat_url, wait_until="domcontentloaded")
        page.locator("select[aria-describedby='host-help'] option[value='fake']").wait_for(
            state="attached", timeout=30000
        )
        new_session = page.locator("details.new")
        if not page.locator("details.new[open]").count():
            new_session.locator("summary").click()
        host = page.locator("select[aria-describedby='host-help']")
        host.select_option("fake")
        model = page.locator("select[aria-describedby='model-help']")
        model.select_option("default")
        assert page.locator("select[aria-describedby='model-help'] option[value='__custom']").count() == 1
        assert page.get_by_text("Catálogo declarado pelo host", exact=False).count() == 1

        page.get_by_role("button", name="Start session").click()
        page.locator(".sessbar").wait_for(timeout=30000)
        assert page.locator(".model-chip").inner_text() == "default"

        prompt = "E2E deterministic chat smoke"
        page.get_by_label("Prompt").fill(prompt)
        page.get_by_role("button", name="Send", exact=True).click()
        page.get_by_text("echo:E2E deterministic chat smoke", exact=False).wait_for(timeout=30000)

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(250)
        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"horizontal overflow: {overflow}px"
        assert page.get_by_label("Prompt").is_visible()
        if not page.locator("details.new[open]").count():
            page.locator("details.new summary").click()
        assert host.is_visible()
        page.screenshot(path=str(output.with_suffix(".png")), full_page=True)

        result.update(
            {
                "status": "PASSED",
                "provider": "fake",
                "model": "default",
                "prompt_echoed": True,
                "mobile_horizontal_overflow_px": overflow,
                "console_errors": console_errors,
                "failed_requests": failed_requests,
                "bad_responses": bad_responses,
                "screenshot": str(output.with_suffix(".png")),
            }
        )
        browser.close()

    output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
