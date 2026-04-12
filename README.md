# HUMAN.md

Personal Pi package containing extensions, skills, and prompts.

Pi is itself very unopinionated, so I made some opinioneated tools for myself. I try to keep the minimalizm of Pi. The idea is to not add too much to context as it mostly confuses the agent.

Still most of them are vibe coded and not as tuned as I would like, use with caution.

## Setup

### Install from GitHub:
```bash
pi install git:github.com/IMackerI/pi-agent-config
pi install git:github.com/IMackerI/pi-agent-config@v0.1.0
pi install git:github.com/IMackerI/pi-agent-config@development
```

### Configure which tools you want:
```bash
pi config
```

### If you want the Brave Search tool:
```bash
export BRAVE_SEARCH_API_KEY="your-key"
```

### Bigger changes
If you want to change how the tools operate, just tell pi to make a branch of the package and edit the code directly.

## Two-tool architecture

This config now intentionally splits browsing into two specialized paths.
Backward compatibility with the old all-in-one CDP workflow is **not** guaranteed:


1. **Local website debugging (CDP)**
   - Extension: `extensions/cdp-browser.ts`
   - Purpose: debug local apps (`localhost`, `127.0.0.1`, LAN/private dev hosts)
   - Guardrails: local URLs/endpoints by default, explicit override for non-local targets

2. **Internet web search (Brave Search API)**
   - Extension: `extensions/brave-search.ts`
   - Tool: `brave_web_search`
   - Purpose: docs/fact/research search without browser automation

## Required environment

For Brave search tool:

```bash
export BRAVE_SEARCH_API_KEY="your-key"
```
Get key: https://api.search.brave.com


## Contents

- `extensions/`
  - `brave-search.ts`
  - `cdp-browser.ts`
  - `interactive-shell.ts`
  - `planning-questionnaire.ts`
  - `plan-workflow.ts`
  - `retrospective.ts`
- `skills/`
  - `brave-web-search/`
  - `pi-self-modify-guide/`
  - `planning-questionnaire/`
  - `web-cdp-browser/`
- `prompts/`
  - `ask.md`

## Retrospective report

Use `/retrospective` to generate a single self-contained HTML analysis of the **current branch**.

- Output directory: `.pi/conversation-retrospectives/`
- Auto-open: enabled by default
- Opt out opening: `/retrospective --no-open`
- Deterministic/heuristic-only mode: `/retrospective --no-notes`

The report includes:
- session/tool/discovery/error/token stats
- assistant self-review notes (bounded to messages since last compaction, unless `--no-notes`)
- full conversation timeline with user prompts and collapsed assistant outputs + metadata (tool wait, output tokens, etc.)
