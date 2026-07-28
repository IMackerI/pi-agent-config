---
name: dispatch-agents
description: Launch independent Pi agents in visible foreground terminal windows while keeping their output out of the parent session. Use only when the user wants to watch or interact with agents, or explicitly does not want their output returned here; use headless subagents otherwise.
compatibility: Requires pi and a graphical terminal such as Kitty; falls back to tmux when no supported graphical terminal is available.
---

# Dispatch Visible Agents

Launch fresh, interactive Pi sessions in separate visible terminal windows. This parent dispatches and verifies startup only: it does not collect, summarize, or wait for child output.

Do not use this for ordinary delegation. Use the `subagents` skill when work should run headlessly and report back to the parent.

## Prepare tasks

Derive the exact tasks from the conversation. Ask only if scope remains ambiguous, and never silently broaden it. Each child prompt must be self-contained and include its objective, boundaries, relevant paths or links, permitted edits, required checks, and expected completion state.

Cap a batch at four unless the user explicitly requests more. Tasks must not depend on unresolved sibling output or concurrently modify the same checkout.

## Isolation

Read-only agents may share the current directory. Give every concurrent file-writing agent its own Git worktree and branch under an ignored local directory. If work depends on uncommitted files, ask whether to snapshot them or run sequentially rather than creating stale worktrees.

## Model

Use the parent session's current provider/model and thinking level unless the user requests an override. Confirm the model is available with `pi --list-models`; never silently substitute another model.

## Launch

Prefer the active graphical terminal family. Inspect an unfamiliar emulator's `--help` rather than guessing flags.

For Kitty, open one OS window per child:

```bash
printf -v pi_command '%q ' \
  pi --model "$model" --name "$session_name" --thinking "$thinking" "$prompt"

kitty --detach \
  --directory "$child_cwd" \
  --title "$window_title" \
  bash -lc "$pi_command"
```

If no graphical terminal is available, use a detached named tmux session and tell the user how to attach:

```bash
tmux new-session -d -s "$tmux_name" -c "$child_cwd" "$pi_command"
```

Launch sequentially. After each launch, verify that its named Pi session exists and has started its first turn before launching the next. Stop the batch if startup cannot be confirmed within roughly 30 seconds; do not create duplicates.

## Handoff

Report each child’s task, terminal/session name, model and thinking level, and worktree/branch. Leave sessions running for the user to watch and control. Do not read or import their output into this parent unless the user later asks.