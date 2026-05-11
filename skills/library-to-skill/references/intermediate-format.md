# Intermediate Format

One useful intermediate layer is a small normalized record per source page.

```json
{
  "url": "https://example.com/docs/getting-started",
  "title": "Getting Started",
  "version": "v3",
  "topic": "setup",
  "source_type": "official-docs",
  "content": "Clean extracted text from the page.",
  "code_blocks": [
    "import { Client } from 'example'",
    "const client = new Client()"
  ],
  "caveats": [
    "Requires Node 20+",
    "Auth must be configured before first request"
  ],
  "revisit_when": [
    "installation changes",
    "new major version ships",
    "skill needs exact API details"
  ]
}
```

This is mainly a synthesis aid:

- it keeps multiple sources comparable
- it makes version drift easier to spot
- it gives the final skill clean inputs instead of ad hoc page scraps
- it preserves a path back to the original docs

A common packaging flow is:

1. collect canonical sources
2. extract clean text/code
3. normalize per page
4. distill recurring tasks and gotchas
5. write concise `SKILL.md`
6. move depth into `references/*.md`
7. keep source URLs in the references
