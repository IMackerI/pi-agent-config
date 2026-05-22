# Global Agent Preferences (Pi)
Keep this file minimalistic. There should be very few words but they should be of high value. Keep points to one sentence. Everything should be general (applicable from backend to frontend, from code editing to research).

---

## Global (this) AGENTS.md Policy
The role of this file is to describe common mistakes and confusion points that are applicable across the whole system. If you ever encounter anything that surprises you, allert the developer and note it down here or in the project-specific AGENTS.md to prevent future agents from
making the same mistake.

The second purpose is to capture the user preferences for you, the PI agent. This is also for you to operate more smoothly together with the user.

## Local project AGENTS.md Policy
- If the project is small there might not be one. 
- Feel free to create one if you think it would be useful.
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

## VISION.md Policy
- The purpose of this file is to capture the user's vision. It should *not* serve as a task list and you should not race to implement it. You should only use it as a source of context ment for better understanding of the users intent.
- This is always a local file, stored at `.agents/rules/VISION.md`. But it often will not exist.
- If you are working on a bigger project and you don't know where the user is going with it, ask them to create one.
- It should capture:
    - the scope of the project (Is it only for the user? Or a proof of concept? Or a production-ready project?...)
    - the implementation approach (How many people are devs? What code do we touch? How do we test?...)
    - the partitioning of the project
    - of course the vision itself

---

## Environment
- OS: Arch Linux
- Shell: The user uses `fish`; pi should use `bash` internally.
- Python: always use a project-local `.venv`, managed with `uv`
- JavaScript tooling: prefer `bun` / `bunx` over `npm`

---

## Common Mistakes

### How to use the `edit` tool correctly
Correct structure (conceptual):
path: "/absolute/path/to/file.py"
edits: [ { "oldText": "old code here", "newText": "new code here" } ]

Both `path` and `edits` are top-level sibling parameters. Never nest path inside edits.
The oldText must match exactly and be unique.

### Backticks and XML in `write` / `edit` content
Content containing backticks, XML-like tags, or tool invocation syntax will confuse the tool call parser — it interprets them as real tool boundaries.

### Copyable text
There is an extension for copying fenced blocks. If you want something to be copyable, use them.
- Avoid wrapping copyable shell commands in inline backticks when a plain line or fenced block would copy more cleanly.
- Avoid console prompts and $ or > characters in copyable blocks.

### `pi config` scope
`pi config` writes to the scope of the toggled resource, so toggling a user-scoped entry is a global change.

---

## User Preferences

### Be concise (important)
Thinking tokens are cheap, but the tokens you output to the user are expensive - the user reads them slowly and they cost him time. You want to minimize the output tokens while maintaining all the information.
- Don't repeat yourself
- The important part isn't always the summary, but your notes and reporting.
- If the user wants to know more detailed output, they will ask. Default to shorter responses.

### Reporting
If relevant, this should be a part of the final output of any agent. When in doubt, include it to be sure. Here are things the user wants you to report:

- When you find out something unexpected tell the user when you finish.
- When you had to solve a problem in a non-straightforward way.
- When you were forced to take a shortcut or find a workaround.
- When you had to make an assumption about something that was not clear.
- When you find a fundamental limitation that impacts the solution.

### Typecheck
- typecheck if possible after completing a task.

### Teamwork (if working on a project with other people)
- Pay more attention to big changes as they will disrupt the work of others.
- Check the commits and blame more often
- If new commits are found, keep in mind that the project is in a new state and you should understand and respect the changes.