# Retrospective extension plan

Build a `/retrospective` extension that generates a reusable, high-quality HTML report from the full current session branch, writes it to `.pi/conversation-retrospectives/`, and includes actionable learning analysis (especially unnecessary work and incorrect decisions).

## Execution defaults (locked)

- Scope is **current branch only** (`ctx.sessionManager.getBranch()`), not full session tree analytics.
- Output is a **single self-contained HTML** file.
- User `!`/`!!` bash duration is **excluded** from timing metrics.
- Agent notes are generated only from **since last compaction** context (or full branch when no compaction exists), not the whole conversation.
- `/retrospective` **auto-opens** the generated file by default and always prints absolute path + `file://` link; support opt-out via `--no-open`.
- Conversation UI keeps assistant outputs collapsed by default; very large tool-output sections are collapsed/truncated in-view with expand controls.

## Task board

- [x] **Task 1 — Build retrospective data pipeline + metrics engine**
- [x] **Task 2 — Add analysis engine for mistakes, wasted effort, and improvements**
- [x] **Task 3 — Implement reusable HTML report template and renderer**
- [x] **Task 4 — Integrate `/retrospective` command and output/open flow**
- [x] **Task 5 — Validate with smoke checks and update docs/scripts**

> [x] is allowed only after `bun run lint` and relevant tests pass.

---

## Task 1 — Build retrospective data pipeline + metrics engine

### Scope
Create a deterministic program layer that converts session entries into a normalized retrospective dataset and computes all requested session statistics.

### Implementation
- Add a retrospective module (helper files imported by the extension) to:
  - Read current branch via `ctx.sessionManager.getBranch()` (root → current leaf).
  - Normalize entries/messages into timeline records (user, assistant, toolResult, bashExecution, config/meta entries).
  - Index assistant tool calls by `toolCallId` and match corresponding `toolResult` entries.
- Compute aggregate stats:
  - Session start/end/duration.
  - Counts: user prompts, assistant messages, tool calls (total + by tool), bash calls.
  - Error counts: tool errors (`isError`), assistant stop reasons (`error`/`aborted`), bash non-zero exits.
  - Discovery call counts (at minimum: `read`, `ls`, `find`, `grep`; optionally reported as explicit group + percentages).
  - Token/cost summaries from assistant `usage` fields.
- Compute timing stats:
  - Tool-call latency per call (`assistant toolUse timestamp` → matching `toolResult timestamp`).
  - Aggregate tool wait: cumulative and wall-clock-by-cycle.
  - Exclude user `!`/`!!` bash duration from required metrics (intentionally out of scope).
- Produce per-message metadata for UI:
  - For assistant outputs: output tokens, tool call count, tool wait, errors, timestamp, model/provider.
  - For user prompts: timestamp + content length.

### Deliverables
- Retrospective data model/types.
- Session-to-retrospective transformer.
- Metrics calculator with stable JSON output consumed by renderer.

---

## Task 2 — Add analysis engine for mistakes, wasted effort, and improvements

### Scope
Generate “what to do better” analysis automatically, with emphasis on incorrect decisions and unnecessary effort, without running an LLM over the entire conversation history.

### Implementation
- Build a two-layer analyzer:
  1. **Heuristic extractor** (always on):
     - Detect likely missteps from errors, retries, command corrections, ENOENT/path mistakes, shell mismatch patterns, repeated redundant discovery calls.
     - Emit evidence references (entry IDs/timestamps/tool names).
  2. **Agent-notes synthesizer (bounded scope)**:
     - Generate “my own notes” only from entries **since last compaction** (or full current branch if never compacted).
     - Use one bounded synthesis call with strict size limits and compact/structured prompt focused on: wrong decisions, unnecessary effort, and improvements.
     - Keep this optional/failable; if unavailable, heuristic output still renders.
- Keep output schema stable so renderer can display analysis sections consistently.

### Deliverables
- Analyzer module returning structured retrospective insights.
- Evidence-linked “incorrect decisions” list and improvement recommendations.

---

## Task 3 — Implement reusable HTML report template and renderer

### Scope
Build a polished, reusable, self-contained HTML template for every retrospective generation.

### Implementation
- Create a render module that outputs one standalone HTML file (inline CSS/JS + embedded JSON payload).
- Report sections:
  - Header/overview (session identity, generated time, duration).
  - KPI cards (tool calls, discovery ratio, errors, tokens, waits, bash usage).
  - Analysis panels (incorrect decisions, wasted effort, unexpected findings, recommendations).
  - Conversation timeline view:
    - User prompts visible by default.
    - Assistant outputs collapsed by default (`<details>`/accordion), expandable.
    - Per-item metadata badges (timestamps, output tokens, tool wait, tool count, error flags).
    - Nested tool results/bash blocks for traceability, collapsed by default.
    - Assistant thinking blocks (if present) hidden/collapsed by default.
- Add lightweight UI features (filters/search/toggles) without external runtime dependencies.
- For very large content blocks, render truncated preview with explicit expand controls to keep the page responsive.
- Keep template reusable across runs with clear data contract and style separation in code.

### Deliverables
- Reusable HTML template generator.
- Conversation view with required collapse/expand behavior and metadata.

---

## Task 4 — Integrate `/retrospective` command and output/open flow

### Scope
Ship the extension command that runs the retrospective program end-to-end and produces a usable local link.

### Implementation
- Add new extension command `/retrospective`.
- Command flow:
  1. Gather branch data + compute metrics.
  2. Generate analysis.
  3. Render HTML.
  4. Write file to `<cwd>/.pi/conversation-retrospectives/` with timestamped filename.
- Output UX:
  - Emit absolute path and `file://` URL in command feedback.
  - Auto-open via platform opener (`xdg-open`/`open`/`start`) by default.
  - Add `--no-open` argument to skip auto-open when desired.
- Error handling:
  - Graceful message when session has insufficient data.
  - Graceful degradation when analysis model is unavailable.

### Deliverables
- `extensions/retrospective.ts` command integration.
- Generated HTML files in `.pi/conversation-retrospectives/` + link output.

---

## Task 5 — Validate with smoke checks and update docs/scripts

### Scope
Ensure quality and repeatability, and make usage discoverable.

### Implementation
- Add a smoke script that runs retrospective generation in deterministic mode (LLM analysis disabled) against a session fixture/current session and verifies:
  - File is created.
  - HTML contains key sections (stats, analysis, conversation timeline).
- Integrate smoke into `package.json` scripts (or as targeted standalone smoke step).
- Update README with:
  - `/retrospective` usage.
  - Output location.
  - Meaning/limitations of timing metrics.
- Update `.gitignore` if needed to avoid committing generated retrospective artifacts.

### Done criteria
- `bun run lint` passes.
- Relevant smoke test(s) pass.
- Manual run of `/retrospective` produces a valid, readable report and link.

---

## Known constraints to account for in implementation

- “Incorrect decision” detection cannot be perfect deterministically; evidence-linked heuristics plus bounded “notes since last compaction” synthesis are required for practical quality.
