#!/usr/bin/env zsh
# Test harness for the worktree helpers. Run: zsh tests/worktree.test.zsh
emulate -L zsh
setopt err_return no_unset pipe_fail

SCRIPT_DIR="${0:A:h}"
source "$SCRIPT_DIR/../dot_config/zsh/worktree.zsh"

typeset -gi PASS=0 FAIL=0

ok()   { print -P "%F{green}✓%f $1"; (( ++PASS )); }
no()   { print -P "%F{red}✗%f $1"; (( ++FAIL )); }
check() { if eval "$2"; then ok "$1"; else no "$1 — failed: $2"; fi }

# Build a throwaway repo with seeded env files. Echoes the repo root.
make_repo() {
  local repo
  repo="$(mktemp -d)"
  repo="${repo:A}"   # canonicalize (resolves /var -> /private/var on macOS)
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email t@t.t
  git -C "$repo" config user.name t
  print -- '.env'           >  "$repo/.gitignore"
  print -- '.env.local'     >> "$repo/.gitignore"
  print -- 'apps/*/.env.local' >> "$repo/.gitignore"
  print -- 'EXAMPLE=1'      >  "$repo/.env.example"   # committed, must NOT be copied
  git -C "$repo" add .gitignore .env.example
  git -C "$repo" commit -q -m init
  # untracked, gitignored secrets (root + nested monorepo path)
  print -- 'ROOT=1'         >  "$repo/.env"
  mkdir -p "$repo/apps/web"
  print -- 'WEB=1'          >  "$repo/apps/web/.env.local"
  print -- "$repo"
}

main() {
  local repo; repo="$(make_repo)"
  check "functions are defined" '[[ $(typeset -f worktree) ]]'

  # _wt_main_root resolves the primary checkout from inside the repo
  check "main root from repo" '[[ "$(cd "$repo" && _wt_main_root)" == "$repo" ]]'

  # default container is .worktrees when none exists
  check "default container" '[[ "$(_wt_container "$repo")" == ".worktrees" ]]'
  # an existing plain worktrees/ dir is preferred
  mkdir -p "$repo/worktrees"
  check "existing container preferred" '[[ "$(_wt_container "$repo")" == "worktrees" ]]'
  rmdir "$repo/worktrees"

  # ensure-ignored appends to local exclude when not already ignored
  _wt_ensure_ignored "$repo" ".worktrees"
  check "container now ignored" 'git -C "$repo" check-ignore -q .worktrees'

  # default branch falls back to main
  check "default branch is main" '[[ "$(_wt_default_branch "$repo")" == "main" ]]'

  # creating a worktree makes the branch, the dir, and cds into it
  ( cd "$repo" && worktree feat-x >/dev/null )
  check "worktree dir created" '[[ -d "$repo/.worktrees/feat-x" ]]'
  check "branch created"       'git -C "$repo" show-ref --verify --quiet refs/heads/feat-x'
  check "cd landed in worktree" '[[ "$(cd "$repo" && worktree feat-x >/dev/null && print -r -- $PWD)" == "$repo/.worktrees/feat-x" ]]'

  # explicit base ref is honored
  git -C "$repo" branch dev main >/dev/null
  ( cd "$repo" && worktree off-dev dev >/dev/null )
  check "base ref honored" '[[ "$(git -C "$repo/.worktrees/off-dev" rev-parse HEAD)" == "$(git -C "$repo" rev-parse dev)" ]]'

  # fresh tree gets the gitignored env files at correct relative paths…
  ( cd "$repo" && worktree envtest >/dev/null )
  check "root .env copied"        '[[ -f "$repo/.worktrees/envtest/.env" ]]'
  check "nested env copied"       '[[ -f "$repo/.worktrees/envtest/apps/web/.env.local" ]]'
  # …but committed .env.example is NOT re-copied by the env step (it arrives via checkout anyway)
  check "example present via checkout" '[[ -f "$repo/.worktrees/envtest/.env.example" ]]'
  # copied content matches source
  check "env content matches"     '[[ "$(<"$repo/.worktrees/envtest/.env")" == "ROOT=1" ]]'

  # re-entering an existing worktree must NOT clobber local env edits
  ( cd "$repo" && worktree envtest >/dev/null )                # create (Task 4 already did, but safe)
  print -- 'LOCAL_EDIT=1' > "$repo/.worktrees/envtest/.env"    # local change in the tree
  ( cd "$repo" && worktree envtest >/dev/null )                # re-enter
  check "re-entry does not re-copy" '[[ "$(<"$repo/.worktrees/envtest/.env")" == "LOCAL_EDIT=1" ]]'

  # removing by name takes down the worktree dir
  ( cd "$repo" && worktree to-remove >/dev/null )
  check "tree exists before rm" '[[ -d "$repo/.worktrees/to-remove" ]]'
  # answer "n" to the delete-branch prompt so the branch stays
  ( cd "$repo" && print -- n | wtrm to-remove >/dev/null )
  check "tree gone after rm"     '[[ ! -d "$repo/.worktrees/to-remove" ]]'
  check "branch kept on n"       'git -C "$repo" show-ref --verify --quiet refs/heads/to-remove'

  # wtrm steps out and removes when PWD is exactly the worktree root (not a subdirectory)
  ( cd "$repo" && worktree at-root >/dev/null )
  ( cd "$repo/.worktrees/at-root" && print -- n | wtrm at-root >/dev/null )
  check "rm from worktree root steps out and removes" '[[ ! -d "$repo/.worktrees/at-root" ]]'

  # wtrm errors on an unknown name
  check "wtrm errors on unknown name" '! ( cd "$repo" && wtrm no-such-tree >/dev/null 2>&1 )'
  rm -rf "$repo"

  print
  print -P "%F{cyan}$PASS passed, $FAIL failed%f"
  (( FAIL == 0 ))
}

main "$@"
