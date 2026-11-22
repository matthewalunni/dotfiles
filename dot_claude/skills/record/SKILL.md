---
name: record
description: Use when Matt asks you to record your work, says "record this", "screen record", or starts a coding or CAD task he wants footage of. Starts and stops an OBS screen recording that pauses itself while you wait for him.
---

# Record your work

`obs-ctl` drives OBS. Hooks pause the recording whenever you stop and wait for
Matt (end of turn, permission prompt, AskUserQuestion) and resume it when you
work again, so the file only holds you working. You only start and stop it.

## Start

Pick the scene for the program you're about to use, and a short title saying
what you're doing (it goes in the sidecar file Matt uses to find clips):

```bash
obs-ctl start --scene "Agent Coding" --title "add dark mode to settings page"
obs-ctl start --scene "Agent CAD" --title "model the phone stand hinge"
```

Run it as its own Bash call: the hook claims the recording for your session
from that call. If it fails, tell Matt the error (usually OBS isn't open, or
its WebSocket server is off: Tools > WebSocket Server Settings > Enable).
A "scene not found" warning means `obs-ctl setup` hasn't been run; the
recording still works on the current scene.

## While recording

- Keep the program you're working in in front, so the footage shows the work.
- Before anything secret appears on screen (.env files, tokens, API keys,
  password fields), run `obs-ctl pause --hold`, and `obs-ctl resume` after.
  A held pause is not undone by the hooks.
- Don't pause or resume around waiting for Matt yourself; the hooks do it.

## Stop

When the task is done, before your final message:

```bash
obs-ctl stop
```

It prints the video's path; a `.json` with the same name sits next to it
(title, start and stop times, every pause). Give Matt the path.

`obs-ctl status` shows whether a recording is running and for which session.
