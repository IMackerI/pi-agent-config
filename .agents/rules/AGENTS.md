# Project AGENTS.md (keep minimal)
Only record surprising project-specific notes; global rules are inherited.

## Project-specific environment notes
- `~/.pi/agent` is both live runtime config and the package source repo.

## Important commands
- Validate extension changes with `bunx esbuild extensions/<file>.ts --platform=node --format=esm --log-level=error --outfile=/tmp/<file>.js`.
- Stable flow: work on `development`, promote to `main`, then tag `vX.Y.Z`.

## Common mistakes
- Untracked files inside `extensions/` affect local behavior but are not distributed via git install.
- Keep `PLAN.md` state flow consistent: `[ ]` -> `[/]` -> `[x]` (run lint/tests before `[x]`).

## User preferences
- `/execute` defaults to all pending tasks but must support single-task targeting.
- `/plan` should be guidance-driven (no hard tool blocking).
