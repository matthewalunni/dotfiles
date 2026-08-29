---
description: Audit git worktrees and remove the ones whose work has landed
---

Run `sweep` (in `~/.local/bin`) to audit every worktree in this repository, then act on what it reports.

## How to run it

Start with a plain audit — never jump straight to `--apply`:

```
sweep
```

Add `--branches` to also list merged branches that have no worktree.

The script classifies each worktree as **landed** or **active**, and holds back anything that is dirty, locked, or the one you are currently in. Only clean, landed worktrees are offered for removal.

## What "landed" means, and why it is not just `--is-ancestor`

A branch counts as landed if either:

1. its commits are ancestors of the default branch, or
2. its *content* was squash-merged — the script builds a synthetic commit holding the branch's whole diff and asks `git cherry` whether an equivalent patch is already upstream.

Case 2 matters because squash-merge PR workflows rewrite history: after a squash merge, `git merge-base --is-ancestor` reports the branch as unmerged even though every line of it is in main. A sweep built on ancestry alone would leave those behind forever.

Be aware of the mirror-image trap when checking a branch by hand: `git diff main...branch` shows the branch's changes as a non-empty diff **even when they have landed**, because the merge base does not move on a squash merge. A non-empty three-dot diff is not evidence of unmerged work. To settle it, check whether the branch's distinctive files actually exist on main:

```
git cat-file -e origin/main:path/to/file && echo landed
```

## Applying

Once the audit looks right:

```
sweep --apply          # prompts before deleting
sweep --apply -y       # no prompt
sweep --apply --branches
```

Branch deletion uses `git branch -d`, which refuses to delete genuinely unmerged branches — a safety net beneath the landed check.

## Before you delete, check for files that exist nowhere else

Worktrees routinely hold **gitignored or untracked files that are not duplicated anywhere**: `.env` files, local secrets and xcconfigs, scratch notes, design docs under a gitignored `docs/` path. Removing the worktree destroys them permanently, and the report's `DIRTY` column only counts what `git status` sees — it does not see gitignored files at all.

So when a landed worktree is about to be removed, check for those first:

```
git -C <worktree> status --porcelain -uall
git -C <worktree> status --porcelain --ignored | grep '^!!' | head
```

If anything matters, copy it out before removing. If a worktree is held back only because of untracked files you have already preserved elsewhere, say so explicitly and confirm with the user before overriding — do not `--force` on your own initiative.

## Reporting back

Tell the user what was removed, what was held back and why, and how much disk was reclaimed. Call out anything surprising — a worktree you expected to be landed but was not, or one holding uncommitted work they may have forgotten.
