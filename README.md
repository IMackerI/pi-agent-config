# HUMAN.md

Personal Pi package containing extensions, skills, and prompts.

Pi is itself very unopinionated, so I made some opinioneated tools for myself. I try to keep the minimalizm of Pi. The idea is to not add too much to context as it mostly confuses the agent.

Still most of them are vibe coded and not as tuned as I would like, use with caution. 

## Setup

### Prefered:

Don't setup. 

Use repositories like this to find tools you like. Don't use only this, there are many out there.
Tell pi to summarize them and talk to it about what you like.
Use them just for inspiration or let pi copy and customize them for you.

---

### Install from GitHub:
(Actually I haven't tested this, but it should work in theory.)
```bash
pi install git:github.com/IMackerI/pi-agent-config
pi install git:github.com/IMackerI/pi-agent-config@v0.1.0
pi install git:github.com/IMackerI/pi-agent-config@development
```

### Reconfigure my system prompts
The AGENTS.md is made specific to my workflow. Be sure to tell pi to update the prompts for your system after installation.

### Configure which tools you want:
```bash
pi config
```

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
  - `html-summarize.md`


### If you want the Brave Search tool:
```bash
export BRAVE_SEARCH_API_KEY="your-key"
```
Get key: https://api.search.brave.com

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
