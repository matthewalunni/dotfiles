# Dotfiles

This repository contains my personal dotfiles, managed using a bare Git repository for easy syncing across machines.

## Setup

1. Clone the bare repository:
   ```bash
   git clone --bare https://github.com/matthewalunni/dotfiles.git ~/.dotfiles
   ```

2. Define the `dotfiles` alias in your shell (add to `~/.bashrc`, `~/.zshrc`, etc.):
   ```bash
   alias dotfiles='git --git-dir=$HOME/.dotfiles --work-tree=$HOME'
   ```

3. Configure Git to ignore untracked files:
   ```bash
   dotfiles config --local status.showUntrackedFiles no
   ```

4. Checkout the dotfiles:
   ```bash
   dotfiles checkout
   ```
   If there are conflicts, back up and remove conflicting files, then retry.

## Usage

- **Add a file**: `dotfiles add <file>`
- **Commit changes**: `dotfiles commit -m "message"`
- **Push to GitHub**: `dotfiles push origin main`
- **Pull updates**: `dotfiles pull origin main`
- **Status**: `dotfiles status`
- **View tracked files**: `dotfiles ls-tree --name-only HEAD`

## Files

- `.tmux.conf`: Tmux configuration with Tokyo Night theme colors.

## Notes

- The bare repo is at `~/.dotfiles`.
- Use `dotfiles` instead of `git` for dotfile operations.
- Ensure your shell reloads after adding the alias.