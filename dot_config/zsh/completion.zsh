# Tab completion that teaches you the tool you're typing.
#
# Sourced from ~/.zshrc after compinit and fzf-tab. What it adds:
#   - A preview pane on every fzf-tab menu (via ~/.local/bin/cmd-help):
#       flag        → its entry in the man page / --help, scrollable to the end
#       subcommand  → that subcommand's page (git cl<Tab> → man git-clone)
#       command     → tldr examples, else the man page
#       file / dir  → bat / eza
#   - Keys inside the menu:
#       ctrl-o      open the full man page in a pager, jumped to the flag
#       ctrl-f      enlarge the preview (toggle)
#       ctrl-/      hide/show the preview
#       ctrl-d/u    scroll the preview half a page down/up
#       < / >       switch between completion groups
#   - Alt-H on the command line: full man page for what you've typed so far,
#     jumped to the flag under the cursor.
#   - Completions for tools that don't install one (hunk), flag completion
#     parsed from --help for any other command without one, and
#     GitHub repos for `git clone <Tab>`.

(( $+functions[compdef] )) || return 0

# ---- Menu appearance ------------------------------------------------------
# fzf-tab replaces zsh's own menu; group headers come from this format.
zstyle ':completion:*' menu no
zstyle ':completion:*:descriptions' format '[%d]'
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
zstyle ':fzf-tab:*' switch-group '<' '>'
# Group header rows ("[main porcelain command]", "[plumbing ...]") eat half
# the menu and fzf-tab shows all of them even when none of their rows match.
# brief = only show a header when two groups offer the same word and you need
# it to tell them apart. Rows stay color-coded by group; < / > still switch.
zstyle ':fzf-tab:*' show-group brief

# git <Tab>: everyday commands first. Plumbing (cat-file, checkout-index,
# ...) is git's internal toolkit; it's only offered when nothing above
# matches, so `git cat-<Tab>` still finds cat-file.
zstyle ':completion:*:*:git:*' tag-order \
  'aliases main-porcelain-commands user-commands third-party-commands ancillary-manipulator-commands ancillary-interrogator-commands interaction-commands' \
  'plumbing-manipulator-commands plumbing-interrogator-commands plumbing-sync-commands plumbing-sync-helper-commands plumbing-internal-helper-commands'
# Keep the menu tall enough for the preview to be readable even with 3 matches.
zstyle ':fzf-tab:*' fzf-min-height 24
# Preview on the right, unless that would leave it under 50 columns (a split
# pane): then stack it below so candidate names aren't squeezed to a sliver.
# --nth=2 matches your query against candidate names only; fzf-tab's default
# also matches descriptions, so typing "clone" listed 28 git commands whose
# description happens to say "clone". Alt-D toggles description matching.
typeset -ga _ftb_flags=(
  '--preview-window=right,55%,wrap,border-left,<50(down,55%,wrap,border-top)'
  '--info=inline-right'
  '--nth=2'
)
zstyle ':fzf-tab:*' fzf-flags $_ftb_flags
# keep npm run scripts in package.json order
zstyle ':fzf-tab:complete:npm:*' fzf-flags --no-sort $_ftb_flags

# ---- Preview pane ---------------------------------------------------------
# fzf-tab sets $word, $group, $realpath, $desc and $words for each candidate.
zstyle ':fzf-tab:complete:*' fzf-preview \
  'cmd-help preview "$word" "${group:-}" "${realpath:-}" "$desc" -- "$words[@]"'

zstyle ':fzf-tab:*' fzf-bindings \
  'ctrl-o:execute({_FTB_INIT_}cmd-help open "$word" -- "$words[@]")' \
  'ctrl-f:change-preview-window(down,80%,wrap,border-top|)' \
  'alt-d:change-nth(2,3|2)' \
  'ctrl-/:toggle-preview' \
  'ctrl-d:preview-half-page-down' \
  'ctrl-u:preview-half-page-up'

# ---- Alt-H: full docs for the command being typed -------------------------
# Replaces zsh's default run-help on Alt-H, which only knows man pages and
# ignores subcommands.
_cmd_help_widget() {
  local -a ws=(${(z)LBUFFER})
  # Only the last command of a pipeline / list.
  local i
  for (( i = ${#ws}; i > 0; i-- )); do
    [[ $ws[i] == ('|'|'||'|'&&'|';'|'|&'|'&') ]] && { ws=(${ws[i+1,-1]}); break }
  done
  ws=(${(Q)ws})
  (( ${#ws} )) || return 0
  local cur=$ws[-1]
  [[ $LBUFFER == *[[:space:]] ]] && { cur=''; ws+=('') }
  zle -I
  cmd-help open "$cur" -- "${ws[@]}" </dev/tty
  zle reset-prompt
}
zle -N _cmd_help_widget
bindkey '^[h' _cmd_help_widget
bindkey '^[H' _cmd_help_widget

# ---- Completions for tools that ship a generator but don't install it -----
# Cached under ~/.cache/zsh and regenerated when the tool's binary changes.
_cached_completion() {
  local name=$1; shift
  (( $+commands[$name] )) || return 0
  local cache=${XDG_CACHE_HOME:-$HOME/.cache}/zsh/completions/_$name
  if [[ ! -s $cache || ${commands[$name]:A} -nt $cache ]]; then
    mkdir -p ${cache:h}
    "$@" >| $cache 2>/dev/null || { rm -f $cache; return 0 }
  fi
  source $cache
}
_cached_completion hunk hunk completion zsh
unfunction _cached_completion

# ---- Flags for commands with no completion at all -------------------------
# Typing `sometool -<Tab>` parses `sometool --help`. Only for executables that
# mention "--help" (same guard as cmd-help) so arbitrary scripts aren't run.
_flags_or_default() {
  local exe=${commands[$words[1]]:-}
  if [[ $PREFIX == -* && -n $exe ]] && LC_ALL=C command grep -aqF -- --help $exe; then
    _gnu_generic && return 0
  fi
  _default
}
compdef _flags_or_default -default-

# ---- Use zsh's own git completion -----------------------------------------
# Homebrew's git puts a _git first on $fpath that wraps the bash completion:
# no descriptions for flags or subcommands, and `git clone <Tab>` falls back
# to plain files. zsh ships a far richer _git; load that one instead.
() {
  local f
  for f in $^fpath/_git(N); do
    [[ ${f:A} == */Cellar/git/* ]] && continue
    if command grep -q __git_any_repositories $f; then
      unfunction _git 2>/dev/null
      autoload -Uz $f
      return
    fi
  done
}

# ---- git clone <Tab>: your GitHub repos -----------------------------------
# zsh's _git offers local directories and ssh hosts here, which is noise.
# _git only defines __git_any_repositories if it doesn't exist yet, so this
# one wins; outside `git clone` it behaves exactly like the original.
# Cache: one "owner/repo<TAB>description" per line, refreshed daily.
_gh_repo_cache=${XDG_CACHE_HOME:-$HOME/.cache}/zsh/gh-repos.tsv
_gh_proto_cache=${XDG_CACHE_HOME:-$HOME/.cache}/zsh/gh-protocol

_gh_repos() {
  (( $+commands[gh] )) || return 1
  setopt local_options extended_glob
  # Refresh in the background once a day; first use waits for it.
  if [[ ! -s $_gh_repo_cache ]]; then
    _gh_repos_refresh
  elif [[ -n $_gh_repo_cache(#qN.mh+24) ]]; then
    _gh_repos_refresh &!
  fi
  [[ -s $_gh_repo_cache ]] || return 1

  # URL form follows what you've typed: git@… → ssh, http… → https,
  # nothing yet → your `gh config get git_protocol`.
  local form=https
  if [[ $PREFIX == git@* ]]; then form=ssh
  elif [[ $PREFIX == http* ]]; then form=https
  elif [[ -s $_gh_proto_cache && $(<$_gh_proto_cache) == ssh ]]; then form=ssh
  fi

  local -a repos
  local line name desc url
  for line in ${(f)"$(<$_gh_repo_cache)"}; do
    name=${line%%$'\t'*} desc=${line#*$'\t'}
    [[ $form == ssh ]] && url="git@github.com:$name.git" || url="https://github.com/$name.git"
    repos+=("${url//:/\\:}${desc:+:$desc}")
  done
  # Substring matching, so `git clone dispatch<Tab>` finds
  # https://github.com/you/dispatch.git without typing the whole URL.
  _describe -t github-repositories 'GitHub repository' repos -M 'l:|=* r:|=*'
}

_gh_repos_refresh() {
  mkdir -p ${_gh_repo_cache:h}
  local tmp=$_gh_repo_cache.$$
  gh config get git_protocol >| $_gh_proto_cache 2>/dev/null
  gh repo list --limit 500 --json nameWithOwner,description \
      --jq '.[] | .nameWithOwner + "\t" + ((.description // "") | gsub("[\t\n]"; " "))' \
      >| $tmp 2>/dev/null && command mv -f $tmp $_gh_repo_cache || rm -f $tmp
}

__git_any_repositories() {
  if [[ $curcontext == *:git-clone:* ]]; then
    if [[ $PREFIX == [./~]* ]]; then
      # Local paths only once you start typing one.
      __git_local_repositories
    elif ! _gh_repos && [[ $PREFIX == *[:@]* && $PREFIX != *github.com* ]]; then
      # `host:path` for some other ssh server. Never for github.com: that
      # would try to list remote files over ssh, which GitHub refuses.
      __git_remote_repositories
    fi
  else
    _alternative \
      'local-repositories::__git_local_repositories' \
      'remotes: :__git_remotes' \
      'remote-repositories::__git_remote_repositories'
  fi
}
