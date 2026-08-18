# Git worktree workflow helpers.
#   worktree <name> [base-ref]  create-or-enter a worktree; copy gitignored .env* files
#   worktree                    fzf-pick an existing worktree to cd into
#   wtrm [name]                 remove a worktree (and optionally its branch)
#   worktree-cd                 respawn every other tmux window into this worktree, same subdir

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
    cd "$wtpath" || { print -u2 "worktree: failed to cd into $wtpath"; return 1; }
    return 0
  fi

  [[ -z "$base" ]] && base="$(_wt_default_branch "$root")"

  if git -C "$root" show-ref --verify --quiet "refs/heads/$name"; then
    git -C "$root" worktree add "$wtpath" "$name" || return 1   # attach existing branch
  else
    git -C "$root" worktree add -b "$name" "$wtpath" "$base" || return 1
  fi

  _wt_copy_env "$root" "$wtpath" "$container"
  cd "$wtpath" || { print -u2 "worktree: failed to cd into $wtpath"; return 1; }
}

# Copy gitignored .env* files from main root $1 into worktree $2 (skip container $3),
# preserving each file's path relative to the root. Only gitignored files are copied.
_wt_copy_env() {
  emulate -L zsh
  local root="$1" dest="$2" container="$3"
  local fd_cmd f rel
  local -a files
  fd_cmd="$(command -v fdfind 2>/dev/null || command -v fd 2>/dev/null)"

  if [[ -n "$fd_cmd" ]]; then
    files=("${(@f)$("$fd_cmd" --hidden --no-ignore --type f --glob '.env*' \
      --exclude node_modules --exclude .git --exclude "$container" "$root")}")
  else
    local -a rel
    rel=("${(@f)$(cd "$root" && git ls-files --others --ignored --exclude-standard \
      | grep -E '(^|/)\.env')}")
    local r
    for r in $rel; do [[ -n "$r" ]] && files+=("$root/$r"); done
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
  emulate -L zsh
  git rev-parse --git-dir >/dev/null 2>&1 || { print -u2 "worktree: not inside a git repository"; return 1; }
  local wtpath
  wtpath="$(git worktree list --porcelain \
    | awk '/^worktree /{p=substr($0,10); n=split(p,a,"/"); print p "\t" a[n]}' \
    | fzf --height=80% --reverse --border --prompt='worktree> ' \
        --delimiter $'\t' --with-nth 2 \
        --preview 'git -C {1} log --oneline --decorate --color=always -n 25 2>/dev/null || ls -la {1}' \
        --preview-window=right:60%)" || return 0
  [[ -n "$wtpath" ]] || return 0
  wtpath="${wtpath%%$'\t'*}"
  cd "$wtpath" || { print -u2 "worktree: failed to cd into $wtpath"; return 1; }
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

# Remove a worktree (and optionally its branch). No arg → fzf-pick (excludes main).
wtrm() {
  emulate -L zsh
  local root target wtpath branch ans container
  root="$(_wt_main_root)" || { print -u2 "wtrm: not inside a git repository"; return 1; }
  target="$1"

  if [[ -z "$target" ]]; then
    wtpath="$(git -C "$root" worktree list --porcelain \
      | awk -v r="$root" '/^worktree /{p=substr($0,10); if (p != r) { n=split(p,a,"/"); print p "\t" a[n] }}' \
      | fzf --height=80% --reverse --border --prompt='remove worktree> ' \
          --delimiter $'\t' --with-nth 2 \
          --preview 'git -C {1} log --oneline --decorate --color=always -n 25 2>/dev/null || ls -la {1}' \
          --preview-window=right:60%)" || return 0
    [[ -n "$wtpath" ]] || return 0
    wtpath="${wtpath%%$'\t'*}"
  else
    container="$(_wt_container "$root")"
    wtpath="$root/$container/$target"
  fi

  if [[ "$wtpath" == "$root" ]]; then
    print -u2 "wtrm: refusing to remove the main worktree"; return 1
  fi
  if [[ ! -d "$wtpath" ]]; then
    print -u2 "wtrm: no worktree at $wtpath"; return 1
  fi

  branch="$(git -C "$wtpath" symbolic-ref --quiet --short HEAD 2>/dev/null)"

  # if the shell is inside the tree being removed (at root or deeper), step out first
  if [[ "$PWD" == "$wtpath" || "$PWD" == "$wtpath"/* ]]; then
    cd "$root"
  fi

  if ! git -C "$root" worktree remove "$wtpath" 2>/dev/null; then
    print -n "wtrm: worktree is dirty. Force remove? [y/N] "
    read -r ans
    [[ "$ans" == [yY]* ]] || return 1
    git -C "$root" worktree remove --force "$wtpath" || return 1
  fi

  if [[ -n "$branch" ]]; then
    print -n "wtrm: delete branch '$branch'? [y/N] "
    read -r ans
    [[ "$ans" == [yY]* ]] && git -C "$root" branch -D "$branch" || true
  fi
}

# Where a pane should land in the new worktree: same path relative to its own
# worktree root, rejoined onto $2 (the new root) — or $2 itself if the pane
# wasn't in a git repo, or the relative path doesn't exist in the new worktree.
_wt_cd_target() {
  emulate -L zsh
  local pane_path="$1" new_root="$2" old_top rel target
  old_top="$(git -C "$pane_path" rev-parse --show-toplevel 2>/dev/null)" || { print -r -- "$new_root"; return 0; }
  rel="${pane_path#$old_top}"
  rel="${rel#/}"
  target="$new_root${rel:+/$rel}"
  [[ -d "$target" ]] && print -r -- "$target" || print -r -- "$new_root"
}

# Respawn every other window's active pane in the current tmux session into
# the current worktree, preserving each pane's subdirectory when it exists
# there too. Kills whatever's running in those panes. Skips the pane you're
# typing in.
worktree-cd() {
  emulate -L zsh
  [[ -n "$TMUX" ]] || { print -u2 "worktree-cd: not inside tmux"; return 1; }
  local new_root cur_pane pane_id pane_path target
  new_root="$(git rev-parse --show-toplevel 2>/dev/null)" || { print -u2 "worktree-cd: not inside a git repository"; return 1; }
  cur_pane="$(tmux display-message -p '#{pane_id}')" || return 1
  local -a panes
  panes=("${(@f)$(tmux list-windows -F '#{pane_id}')}")
  for pane_id in $panes; do
    [[ -n "$pane_id" && "$pane_id" != "$cur_pane" ]] || continue
    pane_path="$(tmux display-message -t "$pane_id" -p '#{pane_current_path}')"
    target="$(_wt_cd_target "$pane_path" "$new_root")"
    tmux respawn-pane -k -t "$pane_id" -c "$target"
  done
}

# Ensure "<container>/" is git-ignored in repo $1; append to local exclude if not.
_wt_ensure_ignored() {
  emulate -L zsh
  local root="$1" container="$2" gitdir
  git -C "$root" check-ignore -q "$container" 2>/dev/null && return 0
  gitdir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)" || return 1
  print -- "$container" >> "$gitdir/info/exclude"
}
