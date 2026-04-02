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

Two scripts are included for bootstrapping a fresh Arch machine.

### `install.sh` — Full desktop install

Installs the complete environment: Hyprland, Waybar, Rofi, audio, Bluetooth,
fonts, display manager, containers, and all dotfiles via chezmoi.

```bash
bash install.sh
```

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

## What's Included

- **Alacritty**: Terminal emulator config
- **Neovim**: Editor setup (bob version manager)
- **Zsh**: Shell configuration with zinit, starship, fzf, zoxide
- **Starship**: Shell prompt theme
- **Lazygit**: Git TUI configuration
- **Tmux**: Tmux configuration
