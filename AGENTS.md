# Global Agent Preferences (Pi)
Keep this file minimalistic. There should be very few words but they should be of high value. Keep points to one sentence. Everything should be general (applicable from backend to frontend, from code editing to research).

---

## Global (this) AGENTS.md Policy
The role of this file is to describe common mistakes and confusion points that are applicable across the whole system. If you ever encounter anything that surprises you, allert the developer and note it down here or in the project-specific AGENTS.md to prevent future agents from
making the same mistake.

The second purpose is to capture the user preferences for you, the PI agent. This is also for you to operate more smoothly together with the user.

## Local project AGENTS.md Policy
- Store at `.agents/rules/AGENTS.md`.
- Use Project AGENTS.md to note down project-specific quirks, that surprised you.
- Don't duplicate anything from this file. Agent can see both of them.
- Prepare the file:
- At the top there should be a note to keep the file minimalistic, and to note mostly surprising things that future agents should be aware of.
- Add a section for (at init empty, for the agent to fill in)
    - project-specific environment notes
    - important commands
    - common mistakes
    - user preferences

---

## Environment
- OS: Arch Linux
- Shell: fish (Important)
- Python: always use a project-local `.venv`, managed with `uv`
- JavaScript tooling: prefer `bun` / `bunx` over `npm`

---

## Common Mistakes

### How to use the `edit` tool correctly
Correct structure (conceptual):
path: "/absolute/path/to/file.py"
edits: [ { "oldText": "old code here", "newText": "new code here" } ]

Both `path` and `edits` are top-level sibling parameters. Never nest path inside edits.

### Backticks and XML in `write` / `edit` content
Content containing backticks, XML-like tags, or tool invocation syntax will confuse the tool call parser — it interprets them as real tool boundaries.

### Shell heredocs in fish shell (important)
Avoid shell heredocs/redirections like `cat <<EOF` in `bash` calls here; prefer `write`/`edit` because the fish shell can parse them unexpectedly. If no other option use:
```bash
echo "\
This is a here document,
that spans multiple lines\
"
```

---

## User Preferences

### Be concise
Thinking tokens are cheap, but the tokens you output to the user are expensive - the user reads them slowly and they cost him time. You want to minimize the output tokens while maintaining all the information.
- Don't repeat yourself
- The important part isn't always the summary, but your notes and reporting.

### Reporting
If relevant, this should be a part of the final output of any agent. When in doubt, include it to be sure. Here are things the user wants you to report:

- When you find out something unexpected tell the user when you finish.
- When you had to solve a problem in a non-straightforward way.
- When you were forced to take a shortcut or find a workaround.
- When you had to make an assumption about something that was not clear.
- When you find a fundamental limitation that impacts the solution.

### Typecheck
- typecheck if possible after completing a task.