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
-  At the top there should be a note to keep the file minimalistic, and to note mostly surprising things that future agents should be aware of.
-  Add a section for (at init empty, for the agent to fill in)
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
Thinking tokens are cheap, but the tokens you output to the user are expensive - the user reads them slowly and they cost him time. **You want to minimize the output tokens while giving a good response.**
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

### Use external libraries
Integrating libraries for standard tasks can save a lot of code and make the codebase more readable and maintainable. Unless stated otherwise don't hesitate to add libraries to make code more elegant. I usually don't mind newer and less standard libraries which do a thing well.

### Code practices

#### From Redis manifesto - what to follow
- We're against complexity. We believe designing systems is a fight against complexity. We'll accept to fight the complexity when it's worthwhile but we'll try hard to recognize when a small feature is not worth 1000s of lines of code. Most of the time the best way to fight complexity is by not creating it at all.
- We optimize for joy. We believe writing code is a lot of hard work, and the only way it can be worth is by enjoying it. When there is no longer joy in writing code, the best thing to do is stop. To prevent this, we'll avoid taking paths that will make Redis less of a joy to develop.

#### Tiger style - what to follow
I would avoid some tiger style practices - we are probably not developing important applications.
Simplicity can therefore sometimes beat durability.
- Simplicity is not a free pass. It's not in conflict with our design goals. It need not be a concession or a compromise.
“...simple and elegant systems tend to be easier and faster to design and get right, more efficient in execution, and much more reliable, [but] require hard work and discipline to achieve…”
— Edsger Dijkstra

#### Simplicity
- We should aim for simplicity because simplicity is a prerequisite for reliability.
- Build simple systems by: 
Abstracting - design by answering questions related to what, who, when, where, why, and how.
Choosing constructs that generate simple artifacts.
Simplify by encapsulation.
