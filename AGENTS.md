# Global Agent Preferences (Pi)

---

## Global (this) AGENTS.md Policy
Keep this file minimalistic. There should be very few words but they should be of high value. Keep points to one sentence. Everything should be general (applicable from backend to frontend, from code editing to research).


## Local project AGENTS.md Policy
- If the project is small there might not be one.
- Create one if you think it would be useful.
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

---

## Environment
- OS: Arch Linux
- Shell: The user uses `fish`; pi should use `bash` internally.
- Python: always use a project-local `.venv`, managed with `uv`
- JavaScript tooling: prefer `bun` / `bunx` over `npm`

---

## Common Mistakes

### Copyable text
There is an extension for copying fenced blocks. If you want something to be copyable, use them.

---

## User Preferences

### Reporting of unexpected
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

### Subagents
- Default to lower reasoning levels for bounded well defined work.
- Use higher reasoning (high, xhigh) only for impactfull or difficult tasks.
- For simple tasks, or use gpt-5.3-spark where possible (it is very quick, but not too smart)
- Don't overuse subagents. Use them only when tasked with big tasks.
- Don't use subagents for tasks reqiring small amount of work and a lot of context (that you already have, but agent must spend time gaining).
- Don't use older than the newest models (except 5.3 spark if you need the speed)

## Code practices

### Use external libraries
Integrating libraries for standard tasks can save a lot of code and make the codebase more readable and maintainable. Unless stated otherwise don't hesitate to add libraries to make code more elegant. I usually don't mind newer and less standard libraries which do a thing well.

### Be lazy
This is a good way to smell what is supposed to be implemented. If you want to implement something and it will take a lot of lines, think about it more. It is sometimes not the solution the user wants - there is a chance you are missunderstanding the prompt.
Sometimes the simpler final design means reworking the whole thing. That is fine, just be sure to mention a disclaimer "This is going to be a big change". Especially when it feels small and the complexity is hidden.

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
