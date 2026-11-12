---
name: herdr-proof
description: Use when finishing a task, opening a pull request, or asking Matt to merge. Records what you claim you did, with evidence files, in .herdr/proof.json so Herdr Deck can show each claim as PASS or NO DATA and gate the merge.
---

# Herdr proof file

Herdr Deck reads `.herdr/proof.json` in the repo root (your worktree root) and shows each claim with a verdict. A claim is PASS only when its evidence file exists inside the repo. Everything else is NO DATA. Deck never runs commands from the file; it only checks that the file exists and lets Matt open it.

Do this before you report a task done, open a PR, or ask to merge. Redo it if the work changes afterwards.

## Steps

1. **Exclude `.herdr/` from git** (once per repo; works in worktrees too). Never commit `.herdr/`.

   ```sh
   ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; grep -qxF '.herdr/' "$ex" || echo '.herdr/' >> "$ex"
   mkdir -p .herdr/proof
   ```

2. **List each user-visible claim**: one short sentence per thing Matt would want to check ("Settings screen shows the new toggle", "unit tests pass"). Be honest and specific; do not pad.

3. **Capture evidence** for each claim under `.herdr/proof/`:
   - Test or build output: `cmd 2>&1 | tee .herdr/proof/tests.log`
   - Screenshot: `.png` (e.g. `screencapture -x .herdr/proof/settings.png`, or a simulator/browser screenshot)
   - Screen recording: `.mp4` or `.mov`
   - Other text output: `.txt`, `.md`, `.json`

   Deck opens `.png/.jpg/.gif/.webp/.pdf` in Preview, `.txt/.log/.md/.json` in TextEdit, and `.mp4/.mov/.m4v/.mp3/.wav/.m4a` in QuickTime. Any other type (including `.svg`) is only revealed in Finder, so prefer the formats above. Evidence must be a real file produced by actually running the thing, not a description.

4. **Write (overwrite) `.herdr/proof.json`**:

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
   - `path`: path to the evidence file, **relative to the repo root** (e.g. `.herdr/proof/tests.log`). No leading `/` or `~`, no `..` segment. Otherwise the claim becomes NO DATA. Or `null`.
   - A claim you could not verify stays in the list with `"evidence": null, "path": null`. Do not omit it and do not invent evidence.

5. **Check it**: `node -e 'JSON.parse(require("fs").readFileSync(".herdr/proof.json","utf8"))'` and `ls` each `path`. Mention in your summary which claims have no evidence.

`git status` must not list `.herdr/`.
