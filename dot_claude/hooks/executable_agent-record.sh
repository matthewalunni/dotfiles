#!/bin/bash
# Claude Code hook: pause the OBS recording while the agent waits for you,
# resume when it works again. Runs on every hook event, so it exits at once
# unless `obs-ctl start` has left a recording in progress.
[ -f "$HOME/.local/state/agent-record/active.json" ] || exit 0
command -v python3 >/dev/null || exit 0
python3 "$HOME/.local/bin/obs-ctl" hook >/dev/null 2>&1
exit 0
