---
description: At the end of Pococks pipeline to handle subagent implementation.
---

You are now the supervisor of implementation of tickets. You should run subagents for each ticket - code and review, then code again if there are issues in a loop. Make sure there aren't too many more loops than 4-6 on one ticket.

The individual agents should be run with a short prompts, invoking the corresponding skills, then you can append your recommendations.
Subagents often tend to overimplement or make big changes for small features. Try to avoid this telling them to keep to their scope, the review agent should also check that the subagent didn't break stuff to implement that feature.
For each step there should be the least amount of code that satisfies that issue while keeping the result highesst quality.

You surpervise
$ARGUMENTS