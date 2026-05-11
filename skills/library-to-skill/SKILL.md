---
name: library-to-skill
description: Compile official library or framework documentation into a concise, source-backed skill. Use when no existing skill covers a tool and you want to turn docs, README/examples, API refs, or llms.txt into a task-oriented SKILL.md plus references/.
compatibility: Works best with web search and some content extraction path; Python is a good default fallback.
---

# Library to Skill

Useful defaults for turning internet docs into a skill.

## Preflight

Before extracting anything, it helps to settle three things:

- the niche: raw API skill, framework skill, automation skill, or product-pattern skill
- the first-pass scope: temporary and narrow is usually better than broad and vague
- the source budget: one canonical source plus a few high-value sections is often enough for a strong first draft

If nearby skills already exist, compare them first. This often reveals the missing niche faster than reading lots of docs.

A compact first-pass shape is described in [process-notes.md](references/process-notes.md).

## Source hierarchy

The highest-signal inputs are usually:

1. `llms.txt` / `llms-full.txt`
2. official docs
3. official README and examples
4. official API reference
5. changelog / migration notes
6. community material only for gaps

The main idea is to stay close to canonical sources and keep the original URLs around.

## What to look for

A good skill usually comes from a narrow, task-oriented slice of the docs rather than the whole site. Useful buckets:

- installation / setup
- quickstart
- core concepts
- common workflows
- important API patterns
- examples
- version-specific gotchas
- troubleshooting / sharp edges

The highest-value findings are often not definitions but recurring decisions, stable loops, repeated parameter patterns, sharp edges, and exact limits worth remembering.

## Extraction strategy

Raw text sources are usually better than rendered HTML. If `llms.txt`, raw Markdown, or GitHub raw docs exist, they tend to be excellent inputs.

For extraction, Python is a good default because it is deterministic and reusable:

- fetch with `httpx` or `requests`
- parse HTML only when needed
- tools such as `trafilatura`, `readability-lxml`, or `BeautifulSoup` are enough
- keep headings, paragraphs, code blocks, and tables
- drop navigation, footer, cookie banners, and unrelated page chrome

If a content-grounding tool already returns clean page text, that can replace part of the fetch/parse layer. Python remains a reliable fallback.

For large single-page docs, a good first pass is often to extract only the named sections from the main content container and keep their anchor URLs. That is usually enough to build a useful temporary skill without trying to ingest the whole page.

## Working format

Before writing the skill, it helps to normalize each page into structured notes or JSON. Useful fields:

- URL
- title
- version
- topic
- extracted content
- code blocks
- caveats / gotchas
- when this source is worth revisiting

If needed, see a compact example in [intermediate-format.md](references/intermediate-format.md).

## First-pass packaging

A low-friction first draft is often:

- a short `SKILL.md` with what tends to matter, the working model, a few decision hints, and reference routing
- `references/common-workflows.md` for distilled patterns
- `references/source-map.md` for canonical pages and exact anchors

This keeps the first version useful without pretending to be exhaustive.

## How to distill

The final skill is usually better when organized by user tasks rather than doc sections. The goal is not to compress the whole manual; it is to capture the workflows, patterns, and failure modes that repeatedly matter in real use.

A useful split is:

- `SKILL.md` for the short workflow and routing logic
- `references/` for deeper notes by topic or task

Good reference splits often look like:

- setup
- core concepts
- common workflows
- API patterns
- troubleshooting
- source map

## Source map

Keep traceability. Each reference file should point back to the canonical pages it came from. That gives the model somewhere reliable to look when the synthesized skill omits a detail or the upstream docs change.

## Output shape

The strongest result is usually not a copy of the docs. It is a task-oriented guide plus references back to the canonical sources.
