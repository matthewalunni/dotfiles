# Git worktree workflow helpers.
#   worktree <name> [base-ref]  create-or-enter a worktree; copy gitignored .env* files
#   worktree                    fzf-pick an existing worktree to cd into
#   wtrm [name]                 remove a worktree (and optionally its branch)

worktree() { :; }   # replaced in Task 3

# Absolute path of the primary worktree (source of truth). Non-zero if not in a repo.
_wt_main_root() {
  local common
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  print -r -- "${common:h}"   # parent of <root>/.git
}

# Name of the worktrees container dir under $1 (prefer an existing one).
_wt_container() {
  local root="$1"
  if [[ -d "$root/.worktrees" ]]; then print -- ".worktrees"
  elif [[ -d "$root/worktrees" ]]; then print -- "worktrees"
  else print -- ".worktrees"
  fi
}

# Ensure "<container>/" is git-ignored in repo $1; append to local exclude if not.
_wt_ensure_ignored() {
  local root="$1" container="$2" gitdir
  git -C "$root" check-ignore -q "$container" && return 0
  gitdir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)" || return 1
  print -- "$container" >> "$gitdir/info/exclude"
}
