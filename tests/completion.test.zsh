#!/usr/bin/env zsh
# Tests for cmd-help and ~/.config/zsh/completion.zsh.
# Run: zsh tests/completion.test.zsh
emulate -L zsh
setopt no_unset pipe_fail

SCRIPT_DIR="${0:A:h}"
ROOT="${SCRIPT_DIR:h}"
CMD_HELP="$ROOT/dot_local/bin/executable_cmd-help"
COMPLETION="$ROOT/dot_config/zsh/completion.zsh"

typeset -gi PASS=0 FAIL=0
ok()    { print -P "%F{green}✓%f $1"; (( ++PASS )); }
no()    { print -P "%F{red}✗%f $1"; (( ++FAIL )); }
check() { if eval "$2"; then ok "$1"; else no "$1 — failed: $2"; fi }

# Plain-text preview (no bat colors) for one candidate.
preview() { BAT= FZF_PREVIEW_COLUMNS=100 zsh $CMD_HELP preview "$@" 2>&1 | perl -pe 's/\e\[[0-9;]*m//g' }

# Candidates zsh offers for BUFFER, one per line, via a zpty-driven shell
# with fzf-tab absent (we test the completion functions, not the menu).
complete_words() {
  local buffer=$1 home=$2
  zmodload zsh/zpty
  zpty -b comp "HOME=$home XDG_CACHE_HOME=$home/.cache PATH=$PATH zsh -f -i"
  zpty -w comp "autoload -Uz compinit && compinit -u -D"
  zpty -w comp "source ${(q)COMPLETION}"
  zpty -w comp 'zstyle ":completion:*" list-grouped false; zstyle ":completion:*" format ""'
  # Print every candidate compadd receives, then cancel the completion.
  # (The marker is built from $t so the echoed definition itself never matches.)
  # -O/-A/-D only compute matches into an array without adding them (_git
  # uses that to measure all commands), so only print real additions.
  zpty -w comp 'compadd() { if (( ${@[(I)-[OAD]*]} )); then builtin compadd "$@"; return; fi; local -a a; builtin compadd -O a "$@"; local t=CAND; print -rl -- "$t=${^a}"; builtin compadd "$@" }'
  zpty -w comp 'zle -C _t complete-word _main_complete; bindkey "^Xc" _t; PS1=""'
  zpty -w -n comp "$buffer"$'\x18c'
  # Read until the shell has been quiet for 1.5s (or 20s total).
  zmodload zsh/datetime
  local out line
  local -F idle_since=$EPOCHREALTIME
  local -i deadline=$(( SECONDS + 20 ))
  while (( SECONDS < deadline )); do
    if zpty -r -t comp line; then
      out+=$line; idle_since=$EPOCHREALTIME
    else
      [[ $out == *CAND=* ]] && (( EPOCHREALTIME - idle_since > 1.5 )) && break
      sleep 0.1
    fi
  done
  zpty -d comp
  local -a hits=(${(M)${(f)${out//$'\r'/$'\n'}}:#*CAND=*})
  print -rl -- ${hits#*CAND=}
}

main() {
  # --- cmd-help previews ---
  check "flag preview jumps to the flag's man entry (rg -i)" \
    '[[ $(preview -i "" "" "" -- rg - | head -1) == *"-i, --ignore-case"* ]]'
  check "flag preview uses the subcommand's page (git clone --depth)" \
    '[[ $(preview --depth "" "" "" -- git clone --de | head -1) == *"--depth"* ]]'
  check "subcommand preview shows its man page (git clone)" \
    '[[ $(preview clone "" "" "" -- git cl) == *"git-clone - Clone a repository"* ]]'
  check "flag preview keeps the rest of the page for scrolling" \
    '(( $(preview -i "" "" "" -- rg - | wc -l) > 50 ))'
  check "--no-foo falls back to --foo's entry" \
    '[[ $(preview --no-ignore-case "" "" "" -- rg - | head -1) == *ignore-case* ]]'

  if (( $+commands[hunk] )); then
    check "subcommand with no man page uses its --help (hunk diff)" \
      '[[ $(preview diff "" "" "" -- hunk "") == *"--mode"* ]]'
    check "flag of a --help-only subcommand (hunk diff --staged)" \
      '[[ $(preview --staged "" "" "" -- hunk diff -- | head -1) == *"--staged"* ]]'
  fi

  # A script that ignores its arguments must never be run by a preview.
  local tmp; tmp=$(mktemp -d); tmp=${tmp:A}
  print -r -- '#!/bin/sh
touch "$(dirname "$0")/RAN"' > $tmp/sideeffect
  chmod +x $tmp/sideeffect
  PATH="$tmp:$PATH" preview sub "" "" "a desc" -- sideeffect "" >/dev/null
  PATH="$tmp:$PATH" preview --x "" "" "" -- sideeffect - >/dev/null
  check "never executes a tool that doesn't mention --help" '[[ ! -e $tmp/RAN ]]'
  check "falls back to the candidate's description" \
    '[[ $(PATH="$tmp:$PATH" preview sub "" "" "a desc" -- sideeffect "") == "a desc" ]]'

  # Cached help must refresh when the tool changes.
  export CMD_HELP_CACHE=$tmp/cache
  print -r -- '#!/bin/sh
# handles --help
printf "usage: zz-cmdhelp-fixture\n  --alpha  old text\n  --beta   x\n"' > $tmp/zz-cmdhelp-fixture
  chmod +x $tmp/zz-cmdhelp-fixture
  local first second
  first=$(PATH="$tmp:$PATH" preview --alpha "" "" "" -- zz-cmdhelp-fixture -)
  second=$(PATH="$tmp:$PATH" preview --alpha "" "" "" -- zz-cmdhelp-fixture -)
  check "second preview comes from the cache" '[[ -n $(ls $tmp/cache) && $second == $first ]]'
  sleep 1
  print -r -- '#!/bin/sh
# handles --help
printf "usage: zz-cmdhelp-fixture\n  --alpha  new text, longer\n  --beta   x\n"' > $tmp/zz-cmdhelp-fixture
  check "cache refreshes when the tool changes" \
    '[[ $(PATH="$tmp:$PATH" preview --alpha "" "" "" -- zz-cmdhelp-fixture -) == *"new text"* ]]'
  unset CMD_HELP_CACHE

  print -r -- hello > $tmp/file.txt
  check "file preview shows the file" \
    '[[ $(preview file.txt "" "$tmp/file.txt" "" -- cat "") == *hello* ]]'

  # --- completion functions ---
  local home=$tmp/home; mkdir -p $home/.cache/zsh
  printf 'me/alpha\tfirst repo\nme/dispatch\t\n' > $home/.cache/zsh/gh-repos.tsv
  print https > $home/.cache/zsh/gh-protocol   # fresh files: no background refresh

  local words
  words=$(complete_words 'git clone ' $home)
  check "git clone <Tab> offers GitHub repos" '[[ $words == *"https://github.com/me/alpha.git"* ]]'
  check "git clone <Tab> doesn't list local directories" '[[ $words != *"Library"* ]]'
  check "git clone <Tab> doesn't list /etc/hosts entries" '[[ $words != *localhost* ]]'
  words=$(complete_words 'git clone git@github.com:me/di' $home)
  check "git clone git@…<Tab> offers ssh URLs" '[[ $words == *"git@github.com:me/dispatch.git"* ]]'
  words=$(complete_words 'git clone dispa' $home)
  check "git clone <name fragment><Tab> finds the repo" '[[ $words == *"https://github.com/me/dispatch.git"* ]]'

  words=$(complete_words 'git c' $home)
  check "git c<Tab> offers everyday commands" '[[ $words == *clone* && $words == *commit* ]]'
  check "git c<Tab> hides plumbing" '[[ $words != *checkout-index* && $words != *cat-file* ]]'
  words=$(complete_words 'git cat-' $home)
  check "plumbing still completes when nothing else matches" '[[ $words == *cat-file* ]]'

  if (( $+commands[hunk] )); then
    words=$(complete_words 'hunk ' $home)
    check "hunk <Tab> offers subcommands" '[[ $words == *diff* && $words == *show* ]]'
  fi

  rm -rf $tmp
  print "\n$PASS passed, $FAIL failed"
  (( FAIL == 0 ))
}

main "$@"
