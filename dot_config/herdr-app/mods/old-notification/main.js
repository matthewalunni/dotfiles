// Personal mod (not shipped): one action from the old herdr keymap, run when a
// key opens it with mod.open, then it closes itself. Bound in keys.json.
import { View, div } from "gpui-kit";
import { props, closeOverlay, run, notify, spaces, panes, agents, focused, exec, hc, openOverlay } from "herdr";

const fail = (msg) => notify({ title: "Old herdr: Jump to agent", body: String(msg), level: "warning" });
const activeSpace = () => spaces().find((s) => s.active);
const activeTab = () => activeSpace()?.tabs.find((t) => t.active);
const tabPanes = () => { const t = focused()?.tab; return panes().filter((p) => p.tab === t); };

async function act() {
  // The agent that most recently needs you: blocked first, then finished.
  const rank = { blocked: 2, done: 1 };
  const a = agents().filter((a) => rank[a.status])
    .sort((x, y) => rank[y.status] - rank[x.status] || y.seq - x.seq)[0];
  if (a) run("agent.focus", { terminal: a.address }); else notify({ title: "No agent needs you", level: "info" });
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
