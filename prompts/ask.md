---
description: Ask a question without changing files. Prefers direct answers for simple queries.
---
I have a question: $ARGUMENTS

**Constraints for this request:**
1. **Do NOT change any files.** You are in "read-only/answer" mode.
2. **Simple vs. Complex:**
   - If this is a simple question (logic, syntax, general knowledge), try to answer it **directly** without unnecessary tool usage.
   - Use tools (like `read`, `bash`, or `cdp_*`) only if you need them for context or research.
3. **Web Search:** Avoid heavy web searching unless it's necessary for the specific question.
