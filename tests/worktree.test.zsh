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

# Build a throwaway repo with seeded secret files. Echoes the repo root.
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
  print -- 'Config/Secrets/'   >> "$repo/.gitignore"   # Xcode secrets dir
  print -- 'ios/Config/Secrets.xcconfig' >> "$repo/.gitignore"   # Xcode secrets file
  print -- 'EXAMPLE=1'      >  "$repo/.env.example"   # committed, must NOT be copied
  git -C "$repo" add .gitignore .env.example
  git -C "$repo" commit -q -m init
  # untracked, gitignored secrets (root + nested monorepo path)
  print -- 'ROOT=1'         >  "$repo/.env"
  mkdir -p "$repo/apps/web"
  print -- 'WEB=1'          >  "$repo/apps/web/.env.local"
  mkdir -p "$repo/Config/Secrets" "$repo/ios/Config"
  print -- 'API_KEY = abc'  >  "$repo/Config/Secrets/Debug.xcconfig"
  print -- 'API_KEY = def'  >  "$repo/ios/Config/Secrets.xcconfig"
  print -- 'NOTSECRET=1'    >  "$repo/Config/Secretsauce.txt"   # near-miss, must NOT be copied
  print -- "$repo"
}

main() {
  local repo; repo="$(make_repo)"
  check "functions are defined" '[[ $(typeset -f worktree) ]]'

  # fzf pickers must set their own --preview so they don't inherit the global
  # FZF_DEFAULT_OPTS bat preview, which errors on a worktree (a directory) path.
  check "_wt_switch overrides fzf preview" 'typeset -f _wt_switch | grep -q -- "--preview"'
  check "wtrm overrides fzf preview"       'typeset -f wtrm | grep -q -- "--preview"'

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
  # Xcode secrets travel too: a Config/Secrets/ dir and a Config/Secrets.* file
  check "xcode secrets dir copied"  '[[ -f "$repo/.worktrees/envtest/Config/Secrets/Debug.xcconfig" ]]'
  check "xcode secrets file copied" '[[ -f "$repo/.worktrees/envtest/ios/Config/Secrets.xcconfig" ]]'
  check "xcode secret content matches" '[[ "$(<"$repo/.worktrees/envtest/Config/Secrets/Debug.xcconfig")" == "API_KEY = abc" ]]'
  # a name that merely starts with Secrets is not a secret path
  check "near-miss not copied"      '[[ ! -f "$repo/.worktrees/envtest/Config/Secretsauce.txt" ]]'

  # re-entering an existing worktree must NOT clobber local env edits
  ( cd "$repo" && worktree envtest >/dev/null )                # create (Task 4 already did, but safe)
  print -- 'LOCAL_EDIT=1' > "$repo/.worktrees/envtest/.env"    # local change in the tree
  ( cd "$repo" && worktree envtest >/dev/null )                # re-enter
  check "re-entry does not re-copy" '[[ "$(<"$repo/.worktrees/envtest/.env")" == "LOCAL_EDIT=1" ]]'

  # _wt_create is the shared core: it must put the path, and nothing else, on
  # stdout so the `agent` CLI can capture it. The secret-copy notice and git's
  # own chatter belong on stderr.
  check "_wt_create prints the path" \
    '[[ "$(cd "$repo" && _wt_create createtest 2>/dev/null)" == "$repo/.worktrees/createtest" ]]'
  check "_wt_create stdout is only the path" \
    '[[ "$(cd "$repo" && _wt_create secretstest 2>/dev/null | wc -l | tr -d " ")" == 1 ]]'
  check "_wt_create copied secrets despite quiet stdout" \
    '[[ -f "$repo/.worktrees/secretstest/.env" ]]'
  check "_wt_create is idempotent for an existing tree" \
    '[[ "$(cd "$repo" && _wt_create createtest 2>/dev/null)" == "$repo/.worktrees/createtest" ]]'

  # -b separates the directory name from the branch, which is how `agent` gets
  # an agent-named tree (claude-1) on the branch the user asked for.
  ( cd "$repo" && _wt_create -b feat/branchy dirname-only >/dev/null 2>&1 )
  check "-b uses the name for the directory" '[[ -d "$repo/.worktrees/dirname-only" ]]'
  check "-b checks out the given branch" \
    '[[ "$(git -C "$repo/.worktrees/dirname-only" symbolic-ref --short HEAD)" == "feat/branchy" ]]'
  check "-b did not create a branch named after the dir" \
    '! git -C "$repo" show-ref --verify --quiet refs/heads/dirname-only'
  # an existing branch is attached, not recreated
  git -C "$repo" branch existing-br main >/dev/null
  ( cd "$repo" && _wt_create -b existing-br attach-test >/dev/null 2>&1 )
  check "-b attaches an existing branch" \
    '[[ "$(git -C "$repo/.worktrees/attach-test" symbolic-ref --short HEAD)" == "existing-br" ]]'
  check "_wt_create rejects an unknown option" \
    '! ( cd "$repo" && _wt_create --nope x >/dev/null 2>&1 )'
  check "_wt_create requires a name" '! ( cd "$repo" && _wt_create -b b >/dev/null 2>&1 )'

  # The worktree-create executable is what `agent` actually shells out to. Point
  # it at this repo's copy of the library rather than the deployed one.
  local xdg; xdg="$(mktemp -d)"
  mkdir -p "$xdg/zsh"
  cp "$SCRIPT_DIR/../dot_config/zsh/worktree.zsh" "$xdg/zsh/worktree.zsh"
  local wtcreate="$SCRIPT_DIR/../dot_local/bin/executable_worktree-create"
  check "worktree-create exists" '[[ -f "$wtcreate" ]]'
  check "worktree-create prints the path" \
    '[[ "$(cd "$repo" && XDG_CONFIG_HOME="$xdg" zsh "$wtcreate" exectest 2>/dev/null)" == "$repo/.worktrees/exectest" ]]'
  check "worktree-create made the tree" '[[ -d "$repo/.worktrees/exectest" ]]'
  check "worktree-create copied secrets" '[[ -f "$repo/.worktrees/exectest/.env" ]]'
  check "worktree-create honors a base ref" \
    '[[ "$(cd "$repo" && XDG_CONFIG_HOME="$xdg" zsh "$wtcreate" exec-on-dev dev >/dev/null 2>&1; git -C "$repo/.worktrees/exec-on-dev" rev-parse HEAD)" == "$(git -C "$repo" rev-parse dev)" ]]'
  check "worktree-create errors without a name" \
    '! ( cd "$repo" && XDG_CONFIG_HOME="$xdg" zsh "$wtcreate" >/dev/null 2>&1 )'
  check "worktree-create errors outside a repo" \
    '! ( cd "$xdg" && XDG_CONFIG_HOME="$xdg" zsh "$wtcreate" nope >/dev/null 2>&1 )'
  check "worktree-create passes -b through" \
    '[[ "$(cd "$repo" && XDG_CONFIG_HOME="$xdg" zsh "$wtcreate" -b feat/exec-br execbranch >/dev/null 2>&1; git -C "$repo/.worktrees/execbranch" symbolic-ref --short HEAD)" == "feat/exec-br" ]]'
  check "worktree-create rejects an unknown option" \
    '! ( cd "$repo" && XDG_CONFIG_HOME="$xdg" zsh "$wtcreate" --nope x >/dev/null 2>&1 )'
  rm -rf "$xdg"

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

  # worktree-cd refuses to run outside tmux
  check "functions are defined (worktree-cd)" '[[ $(typeset -f worktree-cd) ]]'
  check "worktree-cd errors outside tmux" '! ( unset TMUX; worktree-cd feat-x >/dev/null 2>&1 )'
  # worktree-cd requires a name once inside tmux
  check "worktree-cd errors without a name" '! ( TMUX=fake worktree-cd >/dev/null 2>&1 )'

  rm -rf "$repo"

  print
  print -P "%F{cyan}$PASS passed, $FAIL failed%f"
  (( FAIL == 0 ))
}

main "$@"
