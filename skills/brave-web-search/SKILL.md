---
name: brave-web-search
description: Search the internet with Brave Search API via brave_web_search. Use for documentation lookup, research, and web facts without browser automation.
compatibility: Requires BRAVE_SEARCH_API_KEY to be configured in the environment.
---

# Brave Web Search

Use this skill for normal web search/research.

Do **not** use CDP local-debug tools for internet search unless the user explicitly wants browser automation on a specific site.

## Prerequisites

1. Ensure `BRAVE_SEARCH_API_KEY` is set.
2. If missing, ask user to configure it (Brave dashboard: https://api.search.brave.com).

## Tool flow

1. Call `brave_web_search` with a precise query.
2. Add `freshness`, `count`, `country`, `searchLang` only when needed.
3. Summarize top matches with source links.
4. If query is ambiguous, run follow-up searches with refined terms.

## Query guidance

- Prefer specific intent terms (`site:`, version names, error text snippets) for technical issues.
- Use freshness filters (`pd`, `pw`, `pm`, `py`) for news or rapidly changing topics.
- Keep default result count modest; increase only when necessary.

## Output guidance

- Prioritize trustworthy sources.
- Include URLs in final answers.
- Mention when no relevant results were found and propose next query variants.
