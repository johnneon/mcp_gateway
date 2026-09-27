---
name: "/task"
id: "task"
category: "Workflow"
description: "Take a Task tracker issue into the agent cycle: read it, discuss the solution, then propose"
---

Take the issue given after `/task` into the cycle from `docs/workflow.md`. Accept a URL, `#<n>`, or `<n>`. Without an argument, ask which issue.

1. Switch to `main` and run `git pull --ff-only` before reading the issue. Stop if the tree is dirty or the pull is not fast-forward. The feature branch is created later from that `main`.
2. Read the issue per the `tracker` skill. Stop and ask if it is closed or its card is already in In review or Done.
3. Name the change per `tracker` and tell the person.
4. Discuss the solution with the person: restate the outcome, list open questions, and propose the approach. Do not write artifacts or code in this step.
5. When the person agrees to propose, start the `developer` subagent in propose mode with the change name and the issue number. The developer switches to `main`, pulls, creates `change/<name>` from that `main`, and moves the card to In progress.
6. Continue with step 2 of `docs/workflow.md`.

If the request describes a task without an issue, do step 1, create the issue per `tracker`, then continue from step 2.
