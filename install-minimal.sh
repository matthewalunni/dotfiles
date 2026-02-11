#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Minimal Arch Linux install script (cyberdeck / Raspberry Pi)
# Terminal-only environment — no desktop, no GUI
# =============================================================================

CHEZMOI_REPO="https://github.com/matthewalunni/dotfiles"  # update if needed

# ── helpers ──────────────────────────────────────────────────────────────────

info()    { printf '\e[1;34m=> \e[0m%s\n' "$*"; }
success() { printf '\e[1;32m✔ \e[0m%s\n' "$*"; }
warn()    { printf '\e[1;33m! \e[0m%s\n' "$*"; }
die()     { printf '\e[1;31m✘ \e[0m%s\n' "$*" >&2; exit 1; }

# ── pacman packages ───────────────────────────────────────────────────────────

PACMAN_PKGS=(
    # system
    base-devel
    git
    openssh
    sudo
    unzip
    networkmanager

    # shell / terminal
    zsh
    tmux
    starship
    zoxide
    fzf
    fd
    ripgrep
    bat
    fastfetch

    # fonts (needed for starship, yazi, btop, lazygit icons)
    ttf-jetbrains-mono-nerd
    ttf-nerd-fonts-symbols
    ttf-nerd-fonts-symbols-mono

    # tools
    lazygit
    yazi
    btop
    chezmoi
    github-cli
    gum
    vim
)

# ── step 1: system update ─────────────────────────────────────────────────────

info "Updating system..."
sudo pacman -Syu --noconfirm

# ── step 2: install pacman packages ──────────────────────────────────────────

info "Installing packages..."
sudo pacman -S --needed --noconfirm "${PACMAN_PKGS[@]}"
success "Packages installed"

# ── step 3: install yay (AUR helper) ─────────────────────────────────────────

if ! command -v yay &>/dev/null; then
    info "Installing yay (AUR helper)..."
    tmp=$(mktemp -d)
    git clone https://aur.archlinux.org/yay.git "$tmp/yay"
    (cd "$tmp/yay" && makepkg -si --noconfirm)
    rm -rf "$tmp"
    success "yay installed"
else
    success "yay already installed"
fi

# ── step 4: install bob + neovim ─────────────────────────────────────────────

if ! command -v bob &>/dev/null; then
    info "Installing bob (neovim version manager)..."
    if command -v cargo &>/dev/null; then
        cargo install bob-nvim
    else
        yay -S --needed --noconfirm bob
    fi
fi

if command -v bob &>/dev/null; then
    info "Installing stable neovim via bob..."
    bob install stable
    bob use stable
    success "Neovim installed"
else
    warn "bob not found; skipping neovim install"
fi

# ── step 5: set default shell to zsh ─────────────────────────────────────────

if [[ "$SHELL" != "$(command -v zsh)" ]]; then
    info "Setting default shell to zsh..."
    chsh -s "$(command -v zsh)"
    success "Default shell set to zsh"
fi

# ── step 6: apply chezmoi dotfiles ────────────────────────────────────────────

if command -v chezmoi &>/dev/null; then
    if [[ -d "$HOME/.local/share/chezmoi/.git" ]]; then
        info "Applying existing chezmoi source directory..."
        chezmoi apply
    else
        info "Initialising chezmoi from $CHEZMOI_REPO..."
        chezmoi init --apply "$CHEZMOI_REPO"
    fi
    success "Dotfiles applied"
else
    die "chezmoi not found even after install — something went wrong"
fi

# ── step 7: enable services ───────────────────────────────────────────────────

info "Enabling services..."
sudo systemctl enable --now NetworkManager
sudo systemctl enable --now sshd
success "Services enabled"

# ── done ──────────────────────────────────────────────────────────────────────

echo
success "Minimal install complete!"
warn "Log out and back in (or reboot) for the shell change to take effect."
