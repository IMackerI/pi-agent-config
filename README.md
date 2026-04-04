# pi-agent-config

Personal Pi package containing extensions, skills, and prompts.

## Install (tell Pi to do it)

In your Pi chat, just ask the agent to install this package.

Examples:
- "Install `git:github.com/IMackerI/pi-agent-config`"
- "Install `git:github.com/IMackerI/pi-agent-config@v0.1.0` (stable tag)"
- "Install `git:github.com/IMackerI/pi-agent-config@development` (latest dev)"

If you prefer direct CLI commands, these are equivalent:

```bash
pi install git:github.com/IMackerI/pi-agent-config
pi install git:github.com/IMackerI/pi-agent-config@v0.1.0
pi install git:github.com/IMackerI/pi-agent-config@development
```

## Enable/disable pieces after install

Ask Pi to open package config and toggle resources:
- "Open `pi config` and let me disable some extensions/skills/prompts"

Direct CLI:

```bash
pi config
```

## Remove completely

Ask Pi:
- "Remove/uninstall `git:github.com/IMackerI/pi-agent-config`"

Direct CLI:

```bash
pi remove git:github.com/IMackerI/pi-agent-config
# or
pi uninstall git:github.com/IMackerI/pi-agent-config
```

## Customize

- Easiest: install `@development` and iterate.
- For your own variant: fork this repo, edit resources, and install from your fork URL/tag/branch.

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
