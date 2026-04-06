---
name: web-cdp-browser
description: Browse websites and interact with page DOM elements using Chrome DevTools Protocol tools (cdp_connect, cdp_navigate, cdp_snapshot, cdp_click, cdp_type, cdp_eval, cdp_html, cdp_screenshot, cdp_console_watch, cdp_network_har, cdp_perf_trace). Use when the user asks for web browsing, scraping, form filling, UI interaction, or page inspection, including network/performance debugging.
compatibility: Requires a Chromium-based browser running locally with --remote-debugging-port=9222 (or another HTTP CDP endpoint).
---

# Web CDP Browser

Use this skill when the user wants browser automation, web browsing, complex web searches, or DOM interaction.

## Preconditions

1. **Always run a browser preflight before any `cdp_*` tool call.**
2. Default endpoint is `http://127.0.0.1:9222`.
3. If CDP is not reachable, auto-start Chrome in the background using:

```bash
if ! curl -sS http://127.0.0.1:9222/json/version >/dev/null 2>&1
    nohup google-chrome-stable \
      --remote-debugging-port=9222 \
      --user-data-dir=/tmp/pi-cdp-profile \
      --no-first-run \
      --no-default-browser-check \
      about:blank >/tmp/pi-cdp-browser.log 2>&1 &
    sleep 1
end
```

4. Then run `cdp_connect` before navigation/interactions.

## Tool flow

1. `cdp_connect` to validate endpoint and pick an active tab.
2. `cdp_navigate` or `cdp_new_tab` to open a page.
3. `cdp_snapshot` to read current content.
4. Use `cdp_click`, `cdp_type`, and `cdp_wait_for` for interaction.
5. Use `cdp_eval` for targeted JS extraction and `cdp_html` for markup.
6. Use `cdp_console_watch` to capture console warnings/errors during a scenario.
7. Use `cdp_network_har` to record requests and export a HAR file.
8. Use `cdp_perf_trace` to capture quick page performance metrics.
9. Use `cdp_screenshot` when visual confirmation is needed.

## Operating guidelines

- Prefer `cdp_snapshot` first before acting.
- For web search tasks, prefer **DuckDuckGo** over Google Search.
- On DuckDuckGo, wait for the **DuckAssist / AI summary** to render (it often appears at the top) before snapshotting. This can save multiple tool calls by providing the answer immediately.
- Use stable selectors (`id`, `name`, `data-*`) over brittle deep CSS.
- After interactions that may trigger navigation, wait (`cdp_wait_for` or built-in wait options).
- Keep extraction focused and concise.
- If blocked by login/captcha/2FA, report clearly and request user help.
