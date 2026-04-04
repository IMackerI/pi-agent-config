# pi-agent-config

Personal Pi package containing extensions, skills, and prompts.

## Install in Pi

Stable (recommended):

```bash
pi install git:github.com/IMackerI/pi-agent-config
```

Pinned stable tag:

```bash
pi install git:github.com/IMackerI/pi-agent-config@v0.1.0
```

Development branch:

```bash
pi install git:github.com/IMackerI/pi-agent-config@development
```

## Contents

- `extensions/`
  - `cdp-browser.ts`
  - `planning-questionnaire.ts`
  - `plan-workflow.ts`
- `skills/`
  - `planning-questionnaire/`
  - `web-cdp-browser/`
- `prompts/`
  - `ask.md`

## Branching workflow

- `main` = stable releases used day to day
- `development` = active iteration branch

Create stable sets by merging/cherry-picking to `main` and tagging (`vX.Y.Z`).
