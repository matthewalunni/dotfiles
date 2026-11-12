// Personal mod (not shipped): one action from the old herdr keymap, run when a
// key opens it with mod.open, then it closes itself. Bound in keys.json.
import { View, div } from "gpui-kit";
import { props, closeOverlay, run, notify, spaces, panes, agents, focused, exec, hc, openOverlay } from "herdr";

const fail = (msg) => notify({ title: "Old herdr: Break pane out", body: String(msg), level: "warning" });
const activeSpace = () => spaces().find((s) => s.active);
const activeTab = () => activeSpace()?.tabs.find((t) => t.active);
const tabPanes = () => { const t = focused()?.tab; return panes().filter((p) => p.tab === t); };

async function act() {
  // tmux break-pane: take the focused terminal out of its pane, give it a new tab.
  const f = focused();
  if (!f?.terminal || tabPanes().length < 2) return;
  run("terminal.park", { terminal: f.terminal });
  run("terminal.keep", { terminal: f.terminal, place: "tab" });
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
