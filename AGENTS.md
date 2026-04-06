# Global Agent Preferences (Pi)
The role of this file is to describe common mistakes and confusion points that are applicable across the whole system. If you ever encounter anything that surprises you, allert the developer and note it down here or in the project-specific AGENTS.md to preven future agents from making the same mistake.

## Project AGENTS.md Policy
- Use Project AGENTS.md to note down project-specific quirks, that surprised you.
- Store at `.agents/rules/AGENTS.md` (to avoid cluttering project root). When initializing this file, add a description similar to this one, but specific to the project.

## Environment
- OS: Arch Linux
- Shell: fish
- Python: always use a project-local `.venv`, managed with `uv`
- JavaScript tooling: prefer `bun` / `bunx` over `npm`

## Surprising Global Quirks

(remove this and fill sequentially as you discover them)