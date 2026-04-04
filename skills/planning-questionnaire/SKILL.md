---
name: planning-questionnaire
description: Use ask_user_questions to gather multiple planning decisions/permissions in a compact interactive questionnaire flow. Use sparingly and mainly when the user explicitly says we are planning features.
compatibility: Requires interactive Pi UI.
---

# Planning Questionnaire

Use this skill when the user wants structured planning input (feature scope, priorities, tradeoffs, approvals).

## When to use

- The user explicitly says we are **planning** (or asks for a structured decision flow).
- You need several related answers at once and want to avoid back-and-forth turns.
- You need optional approvals/permissions tied to a planning decision.

## When NOT to use

- For normal conversation and small clarifications (keep the standard chat flow).
- For one trivial question that can be asked directly in chat.
- Repeatedly in the same session unless the user asks for it.

## Tool

- `ask_user_questions`
  - Supports compact multi-question interactive prompts.
  - Open questions can include suggested answers and still allow custom typed input.
  - Returns structured answers in one tool result.

## Best practices

1. Batch related planning questions into a single call.
2. Keep question count low (typically 2–6).
3. For open questions, provide a few high-quality suggested answers plus custom input.
4. After collecting answers, summarize decisions and propose next steps.
