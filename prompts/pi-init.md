---
description: Initialize a project for pi using the user brief plus repository context
argument-hint: "[project-brief]"
---
Initialize this project for pi.

User brief:
$ARGUMENTS

Use the user's brief plus the current repository contents as context.

Do the setup work, don't make a plan.

1. Inspect the repository structure and key manifests to infer the stack, important libraries, and the likely project shape.
2. Create the local project folders if they do not exist:
   - .agents/rules
   - .agents/skills
3. Initialize .agents/rules/AGENTS.md as a minimal project-local guide based on the global AGENTS.md policy.
   - Keep it short.
   - Add a note at the top to keep it minimal and focused on surprising project-specific facts.
   - Add these empty sections unless the repo already makes something obvious:
     - project-specific environment notes
     - important commands
     - common mistakes
     - user preferences
   - Do not duplicate the global AGENTS.md.
4. Handle vision.
   - Preferred path: create .agents/rules/VISION.md as a lightweight draft from the brief and repo context, then ask the user to review or rewrite it.
   - If the brief is too thin or the project direction is unclear, ask the user to write VISION.md instead and give them a minimal scaffold.
   - Keep VISION.md about intent and direction, not a task checklist.
   - Cover:
     - project scope
     - implementation approach
     - project partitioning
     - the vision itself
5. Discover useful skills for this specific project.
   - Infer major frameworks, libraries, and workflows from the repo.
   - Use the find-skills skill to look for existing skills.
   - Verify quality before choosing.
   - Install the relevant skills locally for the project.
6. Fill important gaps.
   - For major libraries or workflows that do not have a good existing skill, use the library-to-skill skill.
   - Create those generated skills locally inside .agents/skills.
   - Keep generated skills narrow, practical, and source-backed.
7. Finish with a short report listing:
   - files created
   - skills installed locally
   - skills created locally
   - open questions, assumptions, or anything unexpected

Important:
- Be decisive and actually initialize the project.
- Prefer supported local project paths from the current pi setup over invented ones.
- Keep the created project guidance concise.
- If a third-party skill install looks risky or there are multiple equally plausible choices, explain that and ask once before installing.
