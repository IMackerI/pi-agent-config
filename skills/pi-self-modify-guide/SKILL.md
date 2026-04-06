---
name: pi-self-modify-guide
description: When modifying extension/skill/prompt, reference this guide.
---

## Pi Package Git Workflow
- Maintain `~/.pi/agent` as a git repo for extension/skill/prompt versioning.
- Develop changes on the `development` branch.
- Keep `main` stable and only move stable sets there.
- Prefer tagging stable releases on `main` (e.g. `v0.1.0`) for reproducible installs.
