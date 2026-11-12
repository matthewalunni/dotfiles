// Personal mod (not shipped): one action from the old herdr keymap, run when a
// key opens it with mod.open, then it closes itself. Bound in keys.json.
import { View, div } from "gpui-kit";
import { props, closeOverlay, run, notify, spaces, panes, agents, focused, exec, hc, openOverlay } from "herdr";

const fail = (msg) => notify({ title: "Old herdr: Previous pane", body: String(msg), level: "warning" });
const activeSpace = () => spaces().find((s) => s.active);
const activeTab = () => activeSpace()?.tabs.find((t) => t.active);
const tabPanes = () => { const t = focused()?.tab; return panes().filter((p) => p.tab === t); };

async function act() {
  const ps = tabPanes(), i = ps.findIndex((p) => p.focused);
  if (ps.length > 1) run("pane.focus", { pane: ps[(i - 1 + ps.length) % ps.length].pane });
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
