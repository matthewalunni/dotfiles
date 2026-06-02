# Git worktree workflow helpers.
#   worktree <name> [base-ref]  create-or-enter a worktree; copy gitignored .env* files
#   worktree                    fzf-pick an existing worktree to cd into
#   wtrm [name]                 remove a worktree (and optionally its branch)

# Repo default branch: origin/HEAD if set, else main, else master, else current HEAD.
_wt_default_branch() {
  emulate -L zsh
  local root="$1" ref b
  ref="$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)" || true
  [[ -n "$ref" ]] && { print -- "${ref#origin/}"; return 0; }
  for b in main master; do
    git -C "$root" show-ref --verify --quiet "refs/heads/$b" 2>/dev/null && { print -- "$b"; return 0; } || true
  done
  git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null
}

worktree() {
  emulate -L zsh

  if [[ $# -eq 0 ]]; then
    _wt_switch
    return $?
  fi

  local name="$1" base="$2" root container wtpath
  root="$(_wt_main_root)" || { print -u2 "worktree: not inside a git repository"; return 1; }
  container="$(_wt_container "$root")"
  _wt_ensure_ignored "$root" "$container"
  wtpath="$root/$container/$name"

  if [[ -d "$wtpath" ]]; then
    cd "$wtpath"
    return 0
  fi

  [[ -z "$base" ]] && base="$(_wt_default_branch "$root")"

  if git -C "$root" show-ref --verify --quiet "refs/heads/$name"; then
    git -C "$root" worktree add "$wtpath" "$name" || return 1   # attach existing branch
  else
    git -C "$root" worktree add -b "$name" "$wtpath" "$base" || return 1
  fi

  _wt_copy_env "$root" "$wtpath" "$container"
  cd "$wtpath"
}

# Copy gitignored .env* files from main root $1 into worktree $2 (skip container $3),
# preserving each file's path relative to the root. Only gitignored files are copied.
_wt_copy_env() {
  local root="$1" dest="$2" container="$3"
  local fd_cmd f rel i
  local -a files
  fd_cmd="$(command -v fd 2>/dev/null || command -v fdfind 2>/dev/null)"

  if [[ -n "$fd_cmd" ]]; then
    files=("${(@f)$("$fd_cmd" --hidden --no-ignore --type f --glob '.env*' \
      --exclude node_modules --exclude .git --exclude "$container" . "$root")}")
  else
    files=("${(@f)$(cd "$root" && git ls-files --others --ignored --exclude-standard \
      | grep -E '(^|/)\.env')}")
    for i in {1..$#files}; do files[$i]="$root/${files[$i]}"; done
  fi

  local count=0
  for f in $files; do
    [[ -n "$f" ]] || continue
    git -C "$root" check-ignore -q "$f" || continue   # never copy tracked files
    rel="${f#$root/}"
    mkdir -p "$dest/${rel:h}"
    cp "$f" "$dest/$rel"
    (( count++ ))
  done
  (( count > 0 )) && print -- "worktree: copied $count env file(s)"
  return 0
}
# fzf-pick an existing worktree and cd into it.
_wt_switch() {
  local line wtpath
  line="$(git worktree list 2>/dev/null \
    | fzf --height=80% --reverse --border --prompt='worktree> ')" || return 0
  [[ -n "$line" ]] || return 0
  wtpath="${line%% *}"          # first field is the path
  [[ -d "$wtpath" ]] && cd "$wtpath"
}

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
  emulate -L zsh
  local root="$1" container="$2" gitdir
  git -C "$root" check-ignore -q "$container" 2>/dev/null && return 0
  gitdir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)" || return 1
  print -- "$container" >> "$gitdir/info/exclude"
}
