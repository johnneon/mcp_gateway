---
name: "/task"
id: "task"
category: "Workflow"
description: "Take a Task tracker issue into the agent cycle: read it, discuss the solution, then propose"
---

Take the issue given after `/task` into the cycle from `docs/workflow.md`. Accept a URL, `#<n>`, or `<n>`. Without an argument, ask which issue.

1. Read the issue per the `tracker` skill. Stop and ask if it is closed or its card is already in In review or Done.
2. Name the change per `tracker` and tell the person.
3. Discuss the solution with the person: restate the outcome, list open questions, and propose the approach. Do not write artifacts or code in this step.
4. When the person agrees to propose, start the `developer` subagent in propose mode with the change name and the issue number. The developer creates the branch and moves the card to In progress.
5. Continue with step 2 of `docs/workflow.md`.

If the request describes a task without an issue, create the issue per `tracker` first and continue from step 2.
