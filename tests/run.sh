#!/usr/bin/env bash
# Run every test suite: the herdr deck (node), the zsh helpers and obs-ctl.
# Usage: tests/run.sh        exits non-zero if any suite fails
set -uo pipefail
cd "$(dirname "$0")/.."

# node may be lazy-loaded by the zsh nvm wrapper and so absent from a plain PATH.
if ! command -v node >/dev/null; then
  for d in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/node" ] && PATH="$d:$PATH" && break
  done
fi

fail=0
run() { printf '\n== %s\n' "$1"; shift; "$@" || { echo "FAILED: $*"; fail=1; }; }

if command -v node >/dev/null; then
  # glob, not the directory: `node --test <dir>` treats the dir as a module on Node 22
  run "herdr deck (node)" node --test tests/herdr-deck/*.test.js
else
  echo "== herdr deck: skipped (node not found)"
fi
for t in tests/*.test.zsh; do run "$t" zsh "$t"; done
run "obs-ctl (python)" python3 tests/obs-ctl.test.py -q

echo
[ $fail -eq 0 ] && echo "all suites passed" || echo "some suites FAILED"
exit $fail
