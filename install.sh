#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Fresh install script for Arch Linux or macOS
# Installs dependencies and applies chezmoi dotfiles
# =============================================================================

CHEZMOI_REPO="https://github.com/matthewalunni/dotfiles"  # update if needed

# ── helpers ──────────────────────────────────────────────────────────────────

info()    { printf '\e[1;34m=> \e[0m%s\n' "$*"; }
success() { printf '\e[1;32m✔ \e[0m%s\n' "$*"; }
warn()    { printf '\e[1;33m! \e[0m%s\n' "$*"; }
die()     { printf '\e[1;31m✘ \e[0m%s\n' "$*" >&2; exit 1; }

require() { command -v "$1" &>/dev/null || die "Required command not found: $1"; }

apply_dotfiles() {
    if [[ -d "$HOME/.local/share/chezmoi/.git" ]]; then
        info "Applying existing chezmoi source directory..."
        chezmoi apply
    else
        info "Initialising chezmoi from $CHEZMOI_REPO..."
        chezmoi init --apply "$CHEZMOI_REPO"
    fi
    success "Dotfiles applied"
}

# ── macOS ─────────────────────────────────────────────────────────────────────

if [[ "$(uname -s)" == "Darwin" ]]; then
    if ! command -v brew &>/dev/null; then
        info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv)"
        success "Homebrew installed"
    fi

    # Get the source directory (and its Brewfile) before bundling
    brew list chezmoi &>/dev/null || brew install chezmoi
    apply_dotfiles

    info "Installing Homebrew packages..."
    brew bundle --file="$HOME/.local/share/chezmoi/Brewfile"
    success "Homebrew packages installed"

    if [[ "$SHELL" != "$(command -v zsh)" ]]; then
        info "Setting default shell to zsh..."
        chsh -s "$(command -v zsh)"
        success "Default shell set to zsh"
    fi

    echo
    success "Installation complete!"
    exit 0
fi

# ── pacman packages ───────────────────────────────────────────────────────────

PACMAN_PKGS=(
    # system
    base-devel
    git
    openssh
    sudo
    unzip

    # shell / terminal
    zsh
    alacritty
    tmux
    starship
    zoxide
    fzf
    fd
    ripgrep
    bat
    fastfetch

    # wayland / desktop
    hyprland
    hyprpaper
    waybar
    rofi
    mako
    kanshi
    nwg-displays
    swayidle
    wl-clipboard
    cliphist
    xdg-desktop-portal
    xdg-desktop-portal-hyprland
    brightnessctl

    # audio / bluetooth
    pipewire
    pipewire-pulse
    pavucontrol
    bluez
    bluez-utils
    blueman

    # fonts
    ttf-jetbrains-mono-nerd
    ttf-nerd-fonts-symbols
    ttf-nerd-fonts-symbols-mono

    # display manager
    greetd
    greetd-tuigreet

    # tools
    lazygit
    yazi
    btop
    chezmoi
    github-cli
    gum
    libnotify
    wayland-utils

    # containers
    podman
    podman-compose
    podman-docker
    fuse-overlayfs
    fuse2
    slirp4netns

    # node
    nodejs
    npm

    # misc
    firefox
    obs-studio
    vim
    networkmanager
    tlp
    tlp-rdw
    sbctl
)

# ── AUR packages ──────────────────────────────────────────────────────────────

AUR_PKGS=(
    yay
    swaylock-effects
    greetd-regreet
    bibata-cursor-theme
    woff2-font-awesome
    displaylink
    evdi-dkms
)

# ── step 1: system update ─────────────────────────────────────────────────────

info "Updating system..."
sudo pacman -Syu --noconfirm

# ── step 2: install pacman packages ──────────────────────────────────────────

info "Installing pacman packages..."
sudo pacman -S --needed --noconfirm "${PACMAN_PKGS[@]}"
success "Pacman packages installed"

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

# ── step 4: install AUR packages ─────────────────────────────────────────────

info "Installing AUR packages..."
yay -S --needed --noconfirm "${AUR_PKGS[@]}"
success "AUR packages installed"

# ── step 5: install bob (neovim version manager) ──────────────────────────────

if ! command -v bob &>/dev/null; then
    info "Installing bob (neovim version manager)..."
    # bob is available via cargo or AUR; try cargo first
    if command -v cargo &>/dev/null; then
        cargo install bob-nvim
    else
        yay -S --needed --noconfirm bob
    fi
fi

if command -v bob &>/dev/null; then
    info "Installing latest stable neovim via bob..."
    bob install stable
    bob use stable
    success "Neovim installed via bob"
else
    warn "bob not found; skipping neovim install"
fi

# ── step 6: set default shell to zsh ─────────────────────────────────────────

if [[ "$SHELL" != "$(command -v zsh)" ]]; then
    info "Setting default shell to zsh..."
    chsh -s "$(command -v zsh)"
    success "Default shell set to zsh"
fi

# ── step 7: apply chezmoi dotfiles ────────────────────────────────────────────

if command -v chezmoi &>/dev/null; then
    apply_dotfiles
else
    die "chezmoi not found even after install — something went wrong"
fi

# ── step 8: enable services ───────────────────────────────────────────────────

info "Enabling system services..."
sudo systemctl enable --now NetworkManager
sudo systemctl enable --now bluetooth
sudo systemctl enable --now tlp
sudo systemctl enable greetd
success "Services enabled"

# ── done ──────────────────────────────────────────────────────────────────────

echo
success "Installation complete!"
warn "Reboot recommended to start the desktop session."
