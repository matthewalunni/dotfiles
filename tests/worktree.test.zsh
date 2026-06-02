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
  rm -rf "$repo"

  print
  print -P "%F{cyan}$PASS passed, $FAIL failed%f"
  (( FAIL == 0 ))
}

main "$@"
