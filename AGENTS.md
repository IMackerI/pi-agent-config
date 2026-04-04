# Global Agent Preferences (Pi)

## Environment
- OS: Arch Linux
- Shell: fish
- Python: always use a project-local `.venv`, managed with `uv`
- JavaScript tooling: prefer `bun` / `bunx` over `npm` unless a project explicitly requires npm
- In Pi, `/tmp` is accessible (no special restriction needed)

## Persistent Knowledge Policy
- If you learn something important about the user, system, or common workflows, persist it.
- Pi does not have a separate "knowledge items" store, so use AGENTS.md files as persistent memory.
- Save project-specific knowledge in the project’s AGENTS file (see below).
- Save cross-project/system-level knowledge in this global file (`~/.pi/agent/AGENTS.md`).

## Project AGENTS.md Policy
- Prefer storing project AI documentation at: `.agents/rules/AGENTS.md` (to avoid cluttering project root).
- For any non-trivial task in a repository, if this file does not exist, create it.
- Keep it comprehensive and useful for someone new to the project (architecture, conventions, setup, tests, common commands, pitfalls, best practices).
- Keep it in sync whenever relevant project information changes.
- If a command fails in a way that reveals useful project constraints, document that in the project AGENTS file.
- After each new feature, update the project AGENTS file.

## Practical Defaults
- Prefer commands and snippets compatible with fish when shell-specific behavior matters.
- Prefer reproducible, project-local tooling and documented workflows over ad-hoc global setup.

## User Workflow Preferences
- For browser research tasks, prefer **DuckDuckGo** over Google Search.
- On DuckDuckGo result pages, wait for the **DuckAssist / AI summary** to load before capturing snapshots. This often contains the definitive answer and saves time.
- **Ask Mode (/ask):** When the user uses `/ask`, do not change any files. For simple questions, prefer answering directly without heavy tool usage, but use tools if necessary for context.
- **Planning questionnaire UI:** Use `ask_user_questions` sparingly. Prefer normal chat flow by default; use the questionnaire mainly when the user explicitly says we are planning features and wants structured multi-question input.
- **/plan workflow preference:** Keep /plan clarifications low-friction (usually 1 phase, max 2), keep the agent in the foreground (no hidden background planner), and produce larger implementation tasks (not exploration tasks) in PLAN.md.

## Pi Package Git Workflow
- Maintain `~/.pi/agent` as a git repo for extension/skill/prompt versioning.
- Develop changes on the `development` branch.
- Keep `main` stable and only move stable sets there.
- Prefer tagging stable releases on `main` (e.g. `v0.1.0`) for reproducible installs.
