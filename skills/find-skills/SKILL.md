---
name: find-skills
description: Helps users discover, reuse, scope, and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. Prefer reusing already installed skills or packages before fetching new ones.
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

## Reuse Before Fetch

Before searching the wider ecosystem, first check whether the capability already exists in one of these places:

1. currently loaded skills
2. project settings in `.pi/settings.json`
3. the skill vault in `~/.pi/agent/skill-vault`
4. user settings in `~/.pi/agent/settings.json`
5. already installed packages from `pi list`

Prefer enabling or scoping an already installed skill/package over fetching a new one.

If the skill exists in the vault, prefer `/scope-skill` or adding its absolute path to `.pi/settings.json` over copying or reinstalling it.

Important pi-config nuance:
- Toggling a **user-scoped** resource in `pi config` changes global settings.
- To keep a change repo-local, prefer a **project-scoped** package entry in `.pi/settings.json`.
- If a relevant package exists only at user scope, explain that enabling it in `pi config` will be global and ask whether the user wants that or wants a project-scoped install/reference instead.

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query]` - Search for skills interactively or by keyword
- `npx skills add <package>` - Install a skill from GitHub or other sources
- `npx skills check` - Check for skill updates
- `npx skills update` - Update all installed skills

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Check What Is Already Installed

Before looking outward, inspect the user's current pi setup:

- active skills already in context
- `.pi/settings.json`
- `~/.pi/agent/skill-vault`
- `~/.pi/agent/settings.json`
- `pi list`

If you find a suitable existing skill or package:

1. tell the user it already exists
2. prefer scoping/enabling it for the current project, especially via `/scope-skill` for vault skills
3. only fetch something new if the existing option is clearly not good enough

### Step 3: Check the Leaderboard

If the local setup does not already cover the need, check the [skills.sh leaderboard](https://skills.sh/) to see if a well-known skill already exists for the domain. The leaderboard ranks skills by total installs, surfacing the most popular and battle-tested options.

For example, top skills for web development include:
- `vercel-labs/agent-skills` — React, Next.js, web design (100K+ installs each)
- `anthropics/skills` — Frontend design, document processing (100K+ installs)

### Step 4: Search for Skills

If the leaderboard doesn't cover the user's need, run the find command:

```bash
npx skills find [query]
```

For example:

- User asks "how do I make my React app faster?" → `npx skills find react performance`
- User asks "can you help me with PR reviews?" → `npx skills find pr review`
- User asks "I need to create a changelog" → `npx skills find changelog`

### Step 5: Verify Quality Before Recommending

**Do not recommend a skill based solely on search results.** Always verify:

1. **Install count** — Prefer skills with 1K+ installs. Be cautious with anything under 100.
2. **Source reputation** — Official sources (`vercel-labs`, `anthropics`, `microsoft`) are more trustworthy than unknown authors.
3. **GitHub stars** — Check the source repository. A skill from a repo with <100 stars should be treated with skepticism.

### Step 6: Present Options to the User

When you find relevant skills, present them to the user with:

1. whether it is already available, already installed but not scoped, or needs installation
2. the skill name and what it does
3. the install count and source
4. the enable/install command they can run
5. a link to learn more at skills.sh

Example response:

```
I found a skill that might help! The "react-best-practices" skill provides
React and Next.js performance optimization guidelines from Vercel Engineering.
(185K installs)

To install it:
npx skills add vercel-labs/agent-skills@react-best-practices

Learn more: https://skills.sh/vercel-labs/agent-skills/react-best-practices
```

### Step 7: Offer to Install or Scope

If the user wants to proceed, choose the lightest action that solves the problem:

1. scope/enable an already installed skill or package for the current project
2. install a new skill project-locally if it is project-specific
3. install globally only if the user wants broad reuse

Example install command:

```bash
npx skills add <owner/repo@skill> -g -y
```

The `-g` flag installs globally (user-level) and `-y` skips confirmation prompts.

## Common Skill Categories

When searching, consider these common categories:

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Check popular sources**: Many skills come from `vercel-labs/agent-skills` or `ComposioHQ/awesome-claude-skills`

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using your general capabilities
3. Suggest the user could create their own skill with `npx skills init`

Example:

```
I searched for skills related to "xyz" but didn't find any matches.
I can still help you with this task directly! Would you like me to proceed?

If this is something you do often, you could create your own skill:
npx skills init my-xyz-skill
```
