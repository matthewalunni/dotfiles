export PATH="/usr/local/opt/ruby/bin:$PATH"
export PATH=/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/3.0.0/bin:$PATH

source ~/.bash_profile

# opencode
export PATH=/Users/matthewalunni/.opencode/bin:$PATH

# zoxide
eval "$(zoxide init zsh)"

# bun completions
[ -s "/Users/matthewalunni/.bun/_bun" ] && source "/Users/matthewalunni/.bun/_bun"

# git dotfiles
alias dotfiles='git --git-dir=$HOME/.dotfiles --work-tree=$HOME'

# ========================
# fzf
# ========================
# fzf base setup
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'

# file preview with bat
export FZF_DEFAULT_OPTS="
  --height 80%
  --layout=reverse
  --border
  --preview 'bat --style=numbers --color=always --line-range :500 {}'
  --preview-window=right:60%
"

# find a local file and open it in nvim
ff() {
  local file
  file=$(fzf --query="$1" --select-1 --exit-0) && nvim "$file"
}

# Search files that contain the pattern, preview with bat, open in nvim at the first match
fs() {
  if [[ $# -eq 0 ]]; then
    echo "Usage: rgfzf <pattern>"
    return 1
  fi

  local pattern selected file line
  pattern="$*"

  selected=$(
    rg --hidden --files-with-matches --glob '!.git/*' --no-messages --color=never "$pattern" 2>/dev/null |
    fzf --preview 'bat --style=numbers --color=always --line-range :200 {}' --preview-window=right:60%
  )

  if [[ -n "$selected" ]]; then
    file="$selected"
    # find the first matching line number in that file
    line=$(rg --hidden --no-heading --line-number --color=never "$pattern" "$file" 2>/dev/null | head -n1 | cut -d: -f2)
    if [[ -n "$line" ]]; then
      nvim +"$line" "$file"
    else
      nvim "$file"
    fi
  fi
}

# zoxide + fzf to change directory
fz() {
  local dir
  dir=$(zoxide query -ls | awk '{ $1=""; print substr($0,2) }' |
    fzf --height=80% --reverse --border \
        --preview 'tree -C -L 2 {} | head -200' \
        --preview-window=right:60%)
  [[ -n "$dir" ]] && cd "$dir"
}

# Fancy fuzzy history search (fzf + preview)
fh() {
  local selected
  selected=$(
    fc -rln 1 | sed 's/^[ 0-9]*//' |
    fzf --height=80% --border --reverse \
        --prompt='History> ' \
        --preview 'echo {}' \
        --preview-window=down:3:wrap
  )
  [[ -n "$selected" ]] && print -z "$selected"
}

# ========================
# fzf-tab
# ========================
# Enable Zsh completion system
autoload -Uz compinit
compinit

# ========================
# Antidote
# ========================
# source antidote
source ${ZDOTDIR:-~}/.antidote/antidote.zsh
# Load plugins via Antidote
source ~/.zsh_plugins.zsh

# ========================
# fzf-tab configuration
# ========================
# disable sort when completing `git checkout`
zstyle ':completion:*:git-checkout:*' sort false
# set descriptions format to enable group support
# NOTE: don't use escape sequences (like '%F{red}%d%f') here, fzf-tab will ignore them
zstyle ':completion:*:descriptions' format '[%d]'
# set list-colors to enable filename colorizing
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
# force zsh not to show completion menu, which allows fzf-tab to capture the unambiguous prefix
zstyle ':completion:*' menu no
# preview directory's content with eza when completing cd
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'eza -1 --color=always $realpath'
# custom fzf flags
# NOTE: fzf-tab does not follow FZF_DEFAULT_OPTS by default
zstyle ':fzf-tab:*' fzf-flags --color=fg:1,fg+:2 --bind=tab:accept
# To make fzf-tab follow FZF_DEFAULT_OPTS.
# NOTE: This may lead to unexpected behavior since some flags break this plugin. See Aloxaf/fzf-tab#455.
zstyle ':fzf-tab:*' use-fzf-default-opts yes
# switch group using `<` and `>`
zstyle ':fzf-tab:*' switch-group '<' '>'

# initialize plugins statically with ${ZDOTDIR:-~}/.zsh_plugins.txt
antidote load

# ========================
# some more aliases
# ========================
alias lg='lazygit'
alias ld='lazydocker'
alias n='nvim'
alias c='clear'
alias t='tmux'
