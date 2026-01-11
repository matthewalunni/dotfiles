# Dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/).

## Quick Start

```bash
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

## What's Included

- **Alacritty**: Terminal emulator config
- **Neovim**: Editor setup (bob version manager)
- **Zsh**: Shell configuration with zinit, starship, fzf, zoxide
- **Starship**: Shell prompt theme
- **Lazygit**: Git TUI configuration
- **Tmux**: Tmux configuration
