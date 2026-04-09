---
name: web-cdp-browser
description: Debug local websites via Chrome DevTools Protocol tools (cdp_connect, cdp_navigate, cdp_snapshot, cdp_click, cdp_type, cdp_wait_for, cdp_console_watch, cdp_network_har, cdp_screenshot). Use for localhost/dev-site inspection and interaction.
compatibility: Requires a Chromium-based browser running locally with --remote-debugging-port=9222 (or another local CDP endpoint).
---

# Local Web Debugging (CDP)

Use this skill when the user wants to debug **local** websites (localhost, 127.0.0.1, LAN dev hosts).

Do **not** use this skill for general internet search. Use `brave_web_search` (or Brave search skills) instead.

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
2. `cdp_navigate` to open a local page.
3. `cdp_snapshot` to read current page content.
4. Use `cdp_click`, `cdp_type`, and `cdp_wait_for` for interaction.
5. Use `cdp_console_watch` to capture warnings/errors.
6. Use `cdp_network_har` to capture and export network requests.
7. Use `cdp_screenshot` for visual confirmation.

## Operating guidelines

- Prefer local URLs and local CDP endpoints.
- Use stable selectors (`id`, `name`, `data-*`) over brittle deep CSS.
- After interactions that may trigger navigation, wait (`cdp_wait_for` or built-in wait options).
- For local failures, verify server process, host, and port before retrying.
- If blocked by auth/captcha/manual step, report clearly and ask for user help.
