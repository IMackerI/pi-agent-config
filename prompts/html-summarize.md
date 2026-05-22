---
description: "Build a quick themed HTML summary of current progress and auto-open it (usage: /html-summarize [guidance])"
---
Create a quick, visually engaging HTML summary of what we have done so far in the **current session branch**.

Additional user guidance:
$ARGUMENTS

Requirements:
1. Pick **one random** themed frontend design skill.
   - Prefer a currently scoped/loaded themed `frontend-design-*` skill if available.
   - Otherwise read one from `~/.pi/agent/skill-vault` and use one of these as the theme source:
     - frontend-design-agentic
     - frontend-design-dithered
     - frontend-design-doodle
     - frontend-design-minimal
     - frontend-design-neobrutalism
     - frontend-design-vintage
   - Do not use `frontend-design-general` as the random theme.
2. Summarize progress so far with focus on:
   - original goal(s)
   - key implementation steps completed, in detail
   - important decisions/changes
   - current status and immediate next steps
3. Generate a single standalone HTML file (inline CSS/JS, no external assets).
4. Save it to:
   - `.pi/conversation-retrospectives/html-summary-<timestamp>.html` (within the project)
5. Open it automatically with a bash command after writing.
6. In your final response, include:
   - selected theme
   - absolute path
   - `file://` link

Guidelines:
- This is the place where to explain in detail the progress and decisions made, so be comprehensive.
- Very important is to make the summary fun for the user to read, so keep the text in a playful spacing. Don't use big blocks of text. However, keep the information detailed so the user gains a deep understanding of everything done.
- Don't hesitate to explain difficult concepts or decisions. The main point of this summary is to be informative.
- After reading this, the user should be able to dive into the code and understand what is going on.
- Prioritize the user guidance if provided.
- Do not modify project source files; only create the summary HTML artifact.
