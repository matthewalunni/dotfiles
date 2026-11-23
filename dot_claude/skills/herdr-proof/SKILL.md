---
name: herdr-proof
description: Use when finishing a task, opening a pull request, or asking Matt to merge.
---

# Herdr proof file

Herdr Deck reads `<repo root>/.herdr/proof.json` and shows each claim as PASS or NO DATA, and uses that to gate the merge. Deck only checks that the evidence file exists and lets Matt open it, so the evidence has to be honest: **a claim may point at evidence only if that evidence shows the claim succeeding.** If tests fail, fix them. If you cannot prove a claim, keep it with `"evidence": null, "path": null` and say so in your summary. Never point a claim at a failing log, a description, or a file you did not produce by actually running the thing.

Run this every time you finish a task, open a PR, or ask to merge, and start from scratch each time: re-capture all evidence and rewrite `proof.json`. Never point a claim at a file from an earlier pass.

## Steps

1. **Go to the repo root, exclude `.herdr/` from git, and reset the proof directory.** Deck reads the root's `.herdr/`; from any other directory Deck sees nothing (NO DATA). Works in worktrees too. Never commit `.herdr/`.

   ```sh
   cd "$(git rev-parse --show-toplevel)" || exit 1
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"
   grep -qxF '.herdr/' "$ex" 2>/dev/null || printf '\n.herdr/\n' >> "$ex"
   rm -rf .herdr/proof; mkdir -p .herdr/proof
   ```

   All paths below are relative to this root.

2. **List each user-visible claim**: one short sentence per thing Matt would want to check ("Settings screen shows the new toggle", "unit tests pass"). Be specific; do not pad.

3. **Capture evidence** for each claim under `.herdr/proof/`:
   - Test or build output, failing if the command fails: `set -o pipefail; cmd 2>&1 | tee .herdr/proof/tests.log` (zsh and bash; without pipefail a failing `cmd` still exits 0 because of `tee`). If it fails, do not use the log as evidence.
   - Screenshot: `.png`. Take it with the tool that drives the thing, not a capture of the screen: agent browsers and simulators often sit on a hidden desktop or run headless, so `screencapture` would miss them.
     - Web page: the browser tool's `take_screenshot` with `filePath: ".herdr/proof/<name>.png"` (add `fullPage: true` for the whole page).
     - iOS Simulator: `xcrun simctl io booted screenshot .herdr/proof/<name>.png` (or the simulator tool's screenshot).
     - A native Mac app in front of you: `screencapture -x .herdr/proof/<name>.png`.
   - Screen recording: `.mp4` or `.mov`
   - Other text output: `.txt`, `.md`, `.json`

   Deck opens `.png/.jpg/.gif/.webp/.pdf` in Preview, `.txt/.log/.md/.json` in TextEdit, and `.mp4/.mov/.m4v/.mp3/.wav/.m4a` in QuickTime. Any other type (including `.svg`) is only revealed in Finder, so prefer the formats above.

4. **Write `.herdr/proof.json`** (overwrite):

   ```json
   {
     "claims": [
       { "claim": "Unit tests pass", "evidence": "test log", "path": ".herdr/proof/tests.log" },
       { "claim": "Settings toggle is visible", "evidence": "screenshot", "path": ".herdr/proof/settings.png" },
       { "claim": "Works on a small iPhone", "evidence": null, "path": null }
     ]
   }
   ```

   - `claim`: string, required. Blank claims are dropped.
   - `evidence`: a short label for the kind of evidence (`"test log"`, `"screenshot"`, `"video"`), or `null`.
   - `path`: evidence file path **relative to the repo root** (e.g. `.herdr/proof/tests.log`), or `null`. No leading `/` or `~`, no `..` segment.
   - These all count as NO DATA: a missing `path` (even with `evidence` set), an absolute or `..` path, a missing or empty file, and a symlink pointing outside the repo.

5. **Check it**: `node -e 'JSON.parse(require("fs").readFileSync(".herdr/proof.json","utf8"))'`, and `ls -l` each `path` to confirm it is non-empty. State in your summary which claims have no evidence.

6. **Show the screenshots.** If you captured any images, open them beside your pane so Matt sees them without leaving Herdr: `herdr-show-images .herdr/proof/*.png` (any image paths work). It splits a column to the right of your pane with the images stacked; Matt closes it like any pane. If the command is missing or fails, say where the images are instead.

7. **Prove database changes in Harlequin.** When the task writes to or changes a local database (new tables, migrations, rows written by the feature), or Matt asks you to prove it in the database, show it live in a Harlequin column beside your pane:

   ```sh
   command -v harlequin >/dev/null || uv tool install 'harlequin[postgres]'
   pane=$(herdr-app ls | jq -r --arg t "$HC_TERMINAL_ID" \
     '[.spaces[].tabs[].terminals[] | select(.terminal == $t) | .pane][0] // empty')
   cfg="$PWD/.harlequin.toml"   # the repo's own profile for its local database
   herdr-app do pane.split --direction right ${pane:+--pane $pane} \
     --argv "[\"harlequin\",\"--config-path\",\"$cfg\"]"   # prints {"terminal": "tN", ...}
   hc wait tN --output "Database Connected" --timeout 15
   hc send tN "<select that shows the change>;" && hc keys tN ctrl+j   # ctrl+j runs the query
   hc wait tN --output "Records" --timeout 10
   hc read tN > .herdr/proof/db-<what>.txt                             # evidence for proof.json
   ```

   - The repo root's `.harlequin.toml` holds the profile for the project's local database. If the repo has none, add one there (with the connection string from the project's `docker-compose.yml` or dev setup), never in the dotfiles. Never point it at a production database.
   - Write a query that proves the claim (join the rows the feature wrote, show the new columns), not `select *` on everything. Read-only queries only.
   - Check the saved screen shows the expected rows before citing it as evidence. Leave the column open for Matt; he closes it like any pane.
   - Use `pane.split` with your own pane, not `hc run --bg`: a background terminal is a hidden sub-agent, not a visible column.

`git status` must not list `.herdr/`.
