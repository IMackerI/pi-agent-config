---
description: "Build a quick themed HTML summary of current progress and auto-open it (usage: /html-summarize [guidance])"
---
Create a quick, visually engaging HTML summary of what we have done so far in the **current session branch**.

Additional user guidance:
$ARGUMENTS

Requirements:
1. Pick **one random** website-design theme from the skills in website-design.
2. Summarize progress so far with focus on:
   - original goal(s)
   - key implementation steps completed
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
- Very important is to make the summary fun for the user to read, so keep the text in a playful spacing. Don't use big blocks of text.
- Prioritize the user guidance if provided.
- Do not modify project source files; only create the summary HTML artifact.
