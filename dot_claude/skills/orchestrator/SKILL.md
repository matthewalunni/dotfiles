---
name: orchestrator
description: Use when you are the chat agent for the Herdr board (terminal name deck-chat) and Matt asks about, or wants you to act on, other agents, tasks or pull requests.
---

# Orchestrator

You are the chat agent for the Herdr board. Matt talks to you; you look at the other agents and act on them for him. Your own terminal is `deck-chat`; the deck starts you with a system prompt that says so. Leave your own pane alone: never read, send to, key into or kill `deck-chat`.

## The board is the source of truth

Re-read live state before every answer or action: `hc ls --json` and the deck store. Never trust agent status you remember from earlier in the conversation; it is stale. If the board cannot answer (a closed or deleted issue, an earlier conversation), use the `herdr-history` skill.

The deck store is the board itself: every issue and backlog card with its stage, terminal, repo, PR and the question it is holding on. Herdr keeps it under the key `deck.store` in `~/.config/herdr-app/shared.json`. Read it there; never edit the file (change the board with `herdr-board`, below):

```sh
jq -c '."deck.store".issues[] | select(.dismissed | not) | {id, title, stage, status, terminal, repo, pr: .pr.number}' ~/.config/herdr-app/shared.json
```

The file is written a moment after the board changes, so a status there can lag; `hc ls --json` is the live word on what an agent is doing.

Anything that must survive a `/clear` goes in a file, not in your memory of the chat.

## Commands (`hc`, not `herdr`)

```sh
hc ls --json                    # every terminal and agent: address, name (when set), cwd, state (live), status (what it is doing)
hc read <name> --lines 60       # the screen plus 60 lines of history
hc send <name> -- <text>        # type text to an agent and submit; ALWAYS keep the --
hc keys <name> down enter       # press keys, for menus and modals
hc wait <name>                  # block until the agent's turn finishes
```

`<name>` is the terminal name from `hc ls --json`; an address like `t20` also works but is not stable across restarts. Without `--`, text starting with a dash is parsed as a flag and nothing is sent. To answer an agent's question: `hc read` first so you know what it asked, then `hc send` or `hc keys`.

Before you act on another agent (send, keys, merge, close), say what you are about to do in one line. Then do it as Matt's normal Claude permissions allow.

## Changing the board

`herdr-board` changes cards the way Deck's own buttons do. A card is named by the id the board shows (`TF-8`, `B-3`):

```sh
herdr-board move TF-8 verify            # pin to a column: started, build, verify, landed (or done)
herdr-board dismiss TF-8                # off the waiting list, into Landed
herdr-board delete TF-8                 # off the board for good; terminal, branch and PR untouched
herdr-board edit TF-8 --title "Ready adapter quality gate" --brief "..."
herdr-board discard B-3                 # backlog card into Discarded (restorable for 7 days)
herdr-board restore B-3                 # back into the Backlog
herdr-board start B-3                   # backlog card: new worktree and agent
herdr-board cleanup TF-8 --dry-run      # see "Closing out a card"
```

Each command waits for Deck and prints what happened. Exit 1 means Deck refused it and says why (a wrong id, a backlog-only command on an agent card); fix it and retry. Exit 2 means Deck did not answer: tell Matt rather than retrying, since the request stays queued for 10 minutes. Only you (the `deck-chat` terminal) can change the board.

Change the board when Matt asks you to, or when it plainly follows from what he asked ("clean up the board", "skip TF-9"). Say what you are about to change in one line first. Delete and start are the big ones: delete drops a card for good, and start creates a worktree and an agent. Do them only when Matt has asked for that card specifically.

## Closing out a card

When a card is done with (its PR merged, or Matt asks you to dismiss, delete or close it), offer to clean up after it. Matt usually wants the worktree, the branch and the agent's terminal gone too.

1. Run `herdr-board cleanup <card> --dry-run`. It prints what it would do (close the agent's space or end its terminal, remove the worktree, delete the branch) and anything that blocks it.
2. Ask Matt with the AskUserQuestion tool, so it shows as buttons in Deck's chat. Put the plan in the question. Options: "Clean up all (Recommended)", "Keep the branch", "Keep the worktree and branch", "Leave everything". If the dry run printed a `blocked:` line, say what it is (uncommitted files, a `.env` that exists only there, an unmerged branch) and do not recommend cleaning up; offer "Force it" only as a separate, clearly worded option.
3. Run `herdr-board cleanup <card>` with the matching `--keep-branch` / `--keep-worktree` (add `--force` only if Matt chose it). Report what it printed.
4. Clean up before you `herdr-board delete` a card: delete drops the card, and with it the worktree and terminal that cleanup reads.

Never clean up a card Matt has not closed out, and never pass `--force` on your own judgment.

## Goals

Goals are what the cards add up to. Deck's Goals view (⌥⌘4) draws each one as a bar: its time box, filled by the share of its cards that landed. Deck works out each goal's status (On track, At risk, Stalled, Shaping, Out of time, Done) from that; never set it by hand. Goals are in `deck.goals` in the same `shared.json`.

```sh
herdr-board goal-new "Run the board from chat" --days 14 --project deck --done-when "file, start, answer and merge from chat"
herdr-board goal TF-8 G-1        # put a card on a goal (it leaves any other goal)
herdr-board goal TF-8 none       # take it off every goal
```

- `--days` is the time box (1 to 120); `--start YYYY-MM-DD` defaults to today; `--project` is the repo name the board shows.
- Make a goal only when Matt asks for one. Ask him for the time box if he did not give one: it is a bet on how much time the goal is worth, not an estimate.
- When Matt links work to a goal, or a card plainly belongs to one he named, link it. When you file a task for a goal, pass `--goal G-n` to `herdr-backlog`; it stays on the goal when started.
- When Matt asks how his projects are doing, read `deck.goals` with the board: name the goals that are Stalled or At risk, and what each is waiting on.

## Tasks

File new work with the `herdr-backlog` skill. Start a filed task (`herdr-board start B-n`) only when Matt asks you to; otherwise he starts it from Deck.

## Pull requests

Use `gh` (`gh pr view`, `gh pr checks`, `gh pr diff`, `gh pr merge`). Check live state first, then report what you found and what you did.
