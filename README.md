# Dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/).

## Quick Start

```bash
# Initialize the repo
chezmoi init <repo_url>

# Apply changes from this repo to your home directory
chezmoi apply

# Edit a dotfile (e.g., .zshrc)
chezmoi edit ~/.zshrc

# See what would change (dry run)
chezmoi diff

# Apply changes after editing
chezmoi apply
```

## Workflow

### Adding New Files

```bash
# Add a file to chezmoi
chezmoi add ~/.config/newfile

# Edit it
chezmoi edit ~/.config/newfile

# Apply changes
chezmoi apply
```

### Making Changes

```bash
# Edit files directly in chezmoi source directory
cd ~/.local/share/chezmoi
nvim dot_zshrc

# Use chezmoi edit command if necessary
chezmoi edit ~/.zshrc

# Preview changes
chezmoi diff

# Apply to home directory
chezmoi apply

# Commit changes as normal
git add .
git commit -m "Update zsh config"
git push
```

### Syncing to Another Machine

```bash
# Pull latest changes
cd ~/.local/share/chezmoi
git pull

# Apply to home directory
chezmoi apply
```

## File Naming

Chezmoi uses prefixes to determine how files are managed:

- `dot_` → `.` (e.g., `dot_zshrc` → `~/.zshrc`)
- `executable_` → makes file executable
- `private_` → sets permissions to 600

## Install Scripts

Two scripts are included for bootstrapping a fresh machine.

### `install.sh` — Full desktop install

On Arch, installs the complete environment: Hyprland, Waybar, Rofi, audio,
Bluetooth, fonts, display manager, containers, and all dotfiles via chezmoi.

On macOS, installs Homebrew, applies the dotfiles, then installs everything in
the `Brewfile` with `brew bundle`.

```bash
bash install.sh
```

> **Note:** The macOS path assumes Apple Silicon (Homebrew in `/opt/homebrew`).
> On an Intel Mac, change the `brew shellenv` line to `/usr/local/bin/brew`.

### `install-minimal.sh` — Terminal-only install

A lean setup for cyberdecks, Raspberry Pis, or any machine where you want just
the terminal environment. Includes zsh, tmux, neovim (via bob), and the usual
CLI tools — no desktop or GUI packages.

```bash
bash install-minimal.sh
```

> **Note:** Before running either script on a fresh machine, update the
> `CHEZMOI_REPO` variable at the top to point to your actual GitHub repo URL.

---

## Color Themes

Terminal colors are managed via chezmoi templates. The active theme is set in
`.chezmoidata.toml` and applied across Ghostty, Alacritty, tmux, and lazygit
with a single `chezmoi apply`.

Available themes: `tokyonight`, `earthcode`

```bash
# Edit the theme value in .chezmoidata.toml
chezmoi edit ~/.local/share/chezmoi/.chezmoidata.toml
# Change: theme = "earthcode"  →  theme = "tokyonight"

# Apply to all configs
chezmoi apply
```

To add a new theme, add a `[themes.mytheme]` block to `.chezmoidata.toml`
with the same keys as an existing theme, then set `theme = "mytheme"`.

---

## Desktop Flag

Some configs (Hyprland, Waybar, Rofi, etc.) are only relevant on Arch desktop machines.
They are gated by the `desktop` flag in `.chezmoidata.toml`:

```toml
desktop = false  # default: don't apply Arch-only configs
```

On a desktop Arch machine, override this in your local config:

```toml
# ~/.config/chezmoi/chezmoi.toml (not tracked)
[data]
desktop = true
```

Then `chezmoi apply` will include the Hyprland and desktop-specific configs.
On non-desktop machines (macOS, WSL, headless servers), leave it as `false`.

---

## Git Worktree Helpers

Defined in `dot_config/zsh/worktree.zsh` (sourced by `.zshrc`). They keep
worktrees in a gitignored `.worktrees/` container at the repo root and copy your
gitignored `.env*` files into each new tree so apps run immediately.

```bash
# Create-or-enter a worktree and cd into it.
# Branches off the repo's default branch (origin/HEAD → main → master).
worktree <name>

# Same, but branch off a specific base ref.
worktree <name> <base-ref>

# No arg: fzf-pick an existing worktree to cd into.
# The preview pane shows that worktree's branch and recent commits.
worktree

# Remove a worktree by name (prompts to delete its branch too).
wtrm <name>

# No arg: fzf-pick a worktree to remove (the main checkout is excluded).
wtrm

# Create-or-locate a worktree and print only its path (no cd, no fzf).
# The non-interactive half of `worktree`, exposed for non-shell callers.
worktree-create [-b branch] <name> [base-ref]
```

Both `worktree` and `worktree-create` go through the same `_wt_create`, so the
interactive and scripted paths cannot drift. The `agent` CLI (below) uses
`worktree-create` rather than reimplementing worktree setup.

Inside tmux, `prefix + W` prompts for a worktree name and runs `worktree-cd`,
which sends a `cd` into every pane currently SSH'd into the codespace so the
whole window follows you into that worktree at once.

The fzf pickers set their own git-log `--preview`, overriding the global
`bat`-based `FZF_DEFAULT_OPTS` preview (which can't render a directory path).

Run the test suite with `zsh tests/worktree.test.zsh`.

---

## Sweeping Landed Worktrees

`sweep` (in `dot_local/bin/`) audits every worktree in the current repo against
the default branch and reports which ones are safe to delete. It reports by
default and only removes things when you ask.

```bash
sweep              # audit and report; changes nothing
sweep --apply      # remove landed, clean worktrees and their branches
sweep --apply -y   # same, skipping the confirmation prompt
sweep --branches   # also delete landed branches that have no worktree
```

A branch counts as *landed* if its commits are ancestors of the base branch, or
if its tree was squash-merged — checked by synthesizing a commit and running
`git cherry`, since ancestry alone reports a false negative for the usual
squash-merge PR workflow. Worktrees that are dirty, locked, or hold commits that
exist nowhere else are reported but never removed, as is the one you're standing
in. There is a matching `/sweep` Claude command in `dot_claude/commands/`.

---

## Reclaiming Cache Space (`reclaim-disk`)

`reclaim-disk` (in `dot_local/bin/`) frees developer cache space that nothing
else garbage-collects. Like `sweep`, it reports by default and only deletes when
asked.

```bash
reclaim-disk              # audit and report; changes nothing
reclaim-disk --apply      # delete, with a confirmation prompt
reclaim-disk --apply -y   # same, skipping the prompt
reclaim-disk --keep 10    # keep 10 newest runs per workspace (default 5)
reclaim-disk --all --keep-sim <udid>   # also simulators, DeviceSupport, all DerivedData
```

XcodeBuildMCP has no retention logic of its own: every `test_sim` run leaves a
`test-products` bundle, a result bundle and a log under
`~/Library/Developer/XcodeBuildMCP/workspaces/`, and nothing ever removes them —
a few hundred MB per run, which is what fills the disk. `reclaim-disk` keeps the
newest few of each per workspace, drops `DerivedData` builds untouched for a
fortnight, and prunes the npm and pnpm caches. A workspace with a non-empty
`locks/` is skipped: a build is in flight and its artifacts are live.

It refuses to run against any root outside `~/Library/Developer`, so a mistyped
override can't point it at `$HOME`. Simulators, iOS DeviceSupport and
`~/Downloads` are left alone unless you opt in — those are judgment calls, not
garbage:

- `--simulators` deletes devices shut down and not booted for `--stale-days`
  (default 7), unavailable devices, then runtimes no surviving device uses and
  nothing has used in that window (so the CI runner's runtimes survive). Booted
  devices and any `--keep-sim <udid>` (or `RECLAIM_KEEP_SIMS`) are never touched.
  Everything goes through `simctl`, never `rm`.
- `--device-support` keeps only the newest OS per device model.
- `--derived-age N` changes the DerivedData threshold; `0` clears it all.
- `--all` is all three at their most aggressive.

Run the test suite with `zsh tests/reclaim-disk.test.zsh`.

---

## Parallel iOS Agents (`agent`)

`agent-ios/` holds a small Go CLI for running several coding agents against one
iOS project at once, each in its own worktree with its own simulator, so they
don't fight over build directories or devices. It is listed in `.chezmoiignore`
— it lives in this repo but is never deployed into `$HOME`; build it instead:

```bash
agent-ios/build.sh          # gofmt + go vet + install to ~/.local/bin/agent
```

```bash
# Launch an agent in its own worktree, leasing a free simulator
agent spawn claude <branch> [--scheme X] [--base ref] [--sim UDID] [--create-sim]

# Target the one connected physical device instead (an exclusive lease)
agent spawn codex <branch> --device
agent device status|claim|release

# Inspect
agent list                  # active agents
agent simulators            # simulators and who holds them
agent devices               # physical devices and who holds them
agent config <agent-id>     # that agent's launch command and MCP wiring
agent doctor                # environment and state drift

agent kill <agent-id>       # release its leases
```

Spawning creates the worktree via `worktree-create`, writes a per-agent MCP
config pointed at that agent's leased device, and starts the coding agent in it.
`--no-launch` registers and leases without starting anything.

---

## What's Included

- **Alacritty**: Terminal emulator config
- **Neovim**: Editor setup (bob version manager)
- **Zsh**: Shell configuration with zinit, starship, fzf, zoxide
- **Starship**: Shell prompt theme
- **Lazygit**: Git TUI configuration
- **Tmux**: Tmux configuration
- **Git worktree helpers**: `worktree` / `wtrm` / `worktree-create` commands (see above)
- **sweep**: reaper for worktrees and branches whose work has landed (see above)
- **agent**: isolated worktree + simulator environments for parallel iOS coding agents (see above)
