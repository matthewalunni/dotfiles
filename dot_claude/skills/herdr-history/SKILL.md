---
name: herdr-history
description: Use when the Herdr board cannot answer, such as a closed or deleted issue, or what Matt and you decided in an earlier chat.
---

# Herdr history

Two append-only files hold what the board no longer shows. Read them only when the live board (`hc ls --json`, the deck store) has no answer.

## Closed issues

`~/.local/state/herdr-deck/closed.jsonl`: one JSON object per line, written when a card is deleted or discarded.

Fields: `key`, `title`, `repo`, `stage`, `pr` (`{number, state}` or null), `brief`, `createdAt`, `removedAt` (epoch ms), `how` (`deleted` or `discarded`).

What did we close last week:

```sh
jq -r --argjson since "$(( ($(date +%s) - 7*86400) * 1000 ))" \
  'select(.removedAt >= $since) | "\(.title) [\(.repo)] \(.how) pr=\(.pr.number // "-")"' \
  ~/.local/state/herdr-deck/closed.jsonl
```

Find one by title: `jq -c 'select(.title | test("login"; "i"))' ~/.local/state/herdr-deck/closed.jsonl`

## Chat archive

`~/.local/state/herdr-deck/chat/`: one file per month, `YYYY-MM.jsonl`, one JSON object per line. It keeps the chat that `/clear` and `/compact` wiped from your context.

Each line is a transcript block plus `at` (epoch ms, when it was archived). Keys: `id`, `session`, `t` (epoch ms of the message), `type` (`text` or `divider`), `role` (`user` or `agent`, on text blocks), `text`, `at`.

Find an earlier decision:

```sh
grep -ih "retry" ~/.local/state/herdr-deck/chat/*.jsonl | jq -r 'select(.type == "text") | "\(.t / 1000 | todate) \(.role): \(.text)"'
```

`-h` drops the filename prefix so jq gets clean JSON. Quote what you found and say which month it came from.
