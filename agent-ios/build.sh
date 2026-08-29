#!/usr/bin/env bash
# Build the `agent` CLI into ~/.local/bin, matching the dot_local/bin convention.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p "$HOME/.local/bin"
gofmt -l . | grep . && { echo "unformatted files above" >&2; exit 1; }
go vet ./...
go build -o "$HOME/.local/bin/agent" .
echo "built $HOME/.local/bin/agent"
