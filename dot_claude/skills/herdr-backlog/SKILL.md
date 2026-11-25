---
name: herdr-backlog
description: Use when you notice work that should become its own separate task, or when Matt asks to file, add, or backlog a task.
---

# Herdr backlog

Files a task into the Herdr Deck Backlog. Matt sees it as a card, then starts it (a fresh worktree and agent) or discards it. Filing is all you do.

## When to use

- You notice work that is out of scope for what you are doing now: a bug, cleanup, follow-up or idea that deserves its own task.
- Matt asks you to file, add or backlog a task.
- Do not use it for work you are about to do yourself in this session.

## Never start the filed task

Filing is not starting. After filing, carry on with your current work. Do not begin the new task, create a worktree or branch for it, or open a terminal for it. Matt starts it from Deck.

## Write a good brief

The brief is all the future agent will have, so make it stand alone. One paragraph:

- What the problem or goal is, and where in the code it lives (files, commands, error text).
- What done looks like: the observable result that tells the agent it is finished.
- What proof to attach: the evidence the agent should capture for `.herdr/proof.json` (test log, screenshot, recording).

The title is short and specific, like an issue title ("Fix flaky login test"), not a sentence of explanation.

## Choose the review cost

Every card says how much of Matt its result will need, so he can let the cheap ones run unattended while he attends the others. Pass `--review` with one of two values:

- `unattended`: Matt can accept the result from the tests and the proof file alone. Research and write-ups, prototypes and spikes, small maintenance (a dependency bump, a flaky test, a typo, a rename, dead code), and anything else the brief's proof checks in full.
- `needs-me`: a significant change, anything that needs design or product judgment, anything Matt must watch while it runs or look at to accept (new UI, behaviour he will feel, data migrations, security, money, anything hard to undo).

When you are unsure, use `needs-me`. Leaving `--review` out means `needs-me` too. Choose by what it costs Matt to review the result, not by how long the work takes: a long research task is `unattended`, a two-line change to how merges work is `needs-me`. Matt can change it on the card (U in Deck).

## Command

Run it from inside the repo (a worktree is fine; it files against the main checkout):

```sh
herdr-backlog --review unattended --title "Fix flaky login test" --brief "tests/login.test.js fails about 1 in 5 runs on the token refresh case because the clock is not mocked. Done when 50 consecutive runs pass. Attach the log of those runs as proof."
```

Add `--repo /absolute/path` only if you are not inside the repo. Add `--goal G-n` when the task serves a goal Matt named (Deck's Goals view lists them); it stays on that goal once started. Quote values; they are stored verbatim and never executed. It prints `Filed B-? <title> (review: <value>)` (Deck assigns the number). A non-zero exit with a message means nothing was filed: fix the arguments and retry.
