#!/bin/sh
# Claude Code status line — mirrors starship.toml prompt style

input=$(cat)

# --- Directory (truncated to 3 segments, repo-aware) ---
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
project_dir=$(echo "$input" | jq -r '.workspace.project_dir // ""')

# Truncate to last 3 path segments
dir=$(echo "$cwd" | awk -F/ '{
  n = NF
  if (n <= 3) { print $0 }
  else { printf "%s/%s/%s", $(n-2), $(n-1), $n }
}')

# Replace $HOME with ~
home="$HOME"
dir=$(echo "$dir" | sed "s|^$home|~|")

# --- Git branch + status ---
branch=""
git_status_str=""

if [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)

  if [ -n "$branch" ]; then
    ahead=$(git -C "$cwd" --no-optional-locks rev-list --count @{u}..HEAD 2>/dev/null || echo "")
    behind=$(git -C "$cwd" --no-optional-locks rev-list --count HEAD..@{u} 2>/dev/null || echo "")

    porcelain=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)

    flags=""
    echo "$porcelain" | grep -q "^??"           && flags="${flags}?"
    echo "$porcelain" | grep -qE "^.M|^MM|^AM"  && flags="${flags}!"
    echo "$porcelain" | grep -qE "^[MADRCU]"    && flags="${flags}+"

    [ -n "$ahead" ] && [ "$ahead" -gt 0 ]  && flags="${flags}⇡"
    [ -n "$behind" ] && [ "$behind" -gt 0 ] && flags="${flags}⇣"

    [ -n "$flags" ] && git_status_str=" ($flags)"
  fi
fi

# --- Language runtime indicators ---
runtime=""
if [ -f "$cwd/package.json" ] || \
   find "$cwd" -maxdepth 1 -name "*.ts" -o -name "*.tsx" -o -name "*.js" 2>/dev/null | grep -q .; then
  runtime="${runtime} "
fi
if [ -f "$cwd/pyproject.toml" ] || [ -f "$cwd/requirements.txt" ] || \
   find "$cwd" -maxdepth 1 -name "*.py" 2>/dev/null | grep -q .; then
  runtime="${runtime} "
fi
if find "$cwd" -maxdepth 1 -name "*.rs" 2>/dev/null | grep -q .; then
  runtime="${runtime} "
fi
if find "$cwd" -maxdepth 1 -name "*.go" 2>/dev/null | grep -q .; then
  runtime="${runtime} "
fi

# --- Context usage ---
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_str=""
[ -n "$used" ] && ctx_str=" ctx:$(printf '%.0f' "$used")%"

# --- Assemble ---
prompt=""

# Directory (bold blue via ANSI)
prompt="${prompt}$(printf '\033[1;34m%s\033[0m' "$dir")"

# Git branch
if [ -n "$branch" ]; then
  prompt="${prompt} $(printf '\033[1;35m %s\033[0m' "$branch")"
fi

# Git status flags
if [ -n "$git_status_str" ]; then
  prompt="${prompt}$(printf '\033[1;33m%s\033[0m' "$git_status_str")"
fi

# Runtime icons
if [ -n "$runtime" ]; then
  prompt="${prompt}$(printf ' \033[1;32m%s\033[0m' "$runtime")"
fi

# Context
if [ -n "$ctx_str" ]; then
  prompt="${prompt}$(printf '\033[2m%s\033[0m' "$ctx_str")"
fi

printf '%s' "$prompt"
