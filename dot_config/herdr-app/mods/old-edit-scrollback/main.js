// Personal mod (not shipped): one action from the old herdr keymap, run when a
// key opens it with mod.open, then it closes itself. Bound in keys.json.
import { View, div } from "gpui-kit";
import { props, closeOverlay, run, notify, spaces, panes, agents, focused, exec, hc, openOverlay } from "herdr";

const fail = (msg) => notify({ title: "Old herdr: Edit scrollback", body: String(msg), level: "warning" });
const activeSpace = () => spaces().find((s) => s.active);
const activeTab = () => activeSpace()?.tabs.find((t) => t.active);
const tabPanes = () => { const t = focused()?.tab; return panes().filter((p) => p.tab === t); };

async function act() {
  // Dump the focused terminal's screen + history to a file and open it in $EDITOR in a new tab.
  const t = focused()?.terminal;
  if (!t) return;
  const r = await exec("sh", ["-c",
    'f=$(mktemp -t herdr-scrollback) && hc read "$1" --lines 100000 > "$f" && printf %s "$f"', "sh", t]);
  if (r.code !== 0) throw new Error(r.stderr || "hc read failed");
  run("terminal.open", { argv: ["sh", "-c", 'exec "${EDITOR:-nvim}" "$1"', "sh", r.stdout.trim()],
    place: "tab", name: "scrollback" });
}

export default class Action extends View {
  init(_props, cx) {
    const overlay = props()?.overlay;
    if (!overlay) return; // `herdr-app check` renders without an overlay: do nothing there
    cx.spawn(async () => {
      try { await act(); } catch (e) { fail(e?.message ?? e); }
      closeOverlay(overlay);
    });
  }
  render() { return div(); }
}
