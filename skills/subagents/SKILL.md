---
name: subagents
description: Spawn and manage isolated, headless Pi subagents for delegated background work. Use when the user requests subagents or a task benefits from independent parallel investigation.
---

# Subagents

Each subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

## Model and reasoning

The child inherits the parent model and thinking level when `model` or `reasoning_effort` is omitted. Override them only when the task needs it or the user asks.

Pi model names use `provider/model-id`; a bare model id only works when unambiguous. Thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

## Spawn and manage

Call `subagent_spawn` with a complete `prompt`, short `name`, optional `working_dir`, and optional `model` and `reasoning_effort`. At most four subagents run concurrently.

- `subagent_check({ id })`: peek without blocking.
- `subagent_list()`: list all runs.
- `subagent_wait({ ids })`: block only when results are required to proceed.
- `subagent_cancel({ ids })`: stop runs while preserving partial transcripts.
- `/subagents`: inspect or take over a run interactively.

Results return automatically. After spawning, continue useful parent work instead of immediately waiting.

Use the `dispatch-agents` skill instead when agents must be visible in foreground terminal windows, the user wants to interact with them, or their output should stay out of this Pi session.