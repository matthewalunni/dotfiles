// Personal mod (not shipped): one action from the old herdr keymap, run when a
// key opens it with mod.open, then it closes itself. Bound in keys.json.
import { View, div } from "gpui-kit";
import { shared, setShared, props, closeOverlay, run, notify, spaces, panes, agents, focused, exec, hc, openOverlay } from "herdr";

const fail = (msg) => notify({ title: "Old herdr: Rotate split", body: String(msg), level: "warning" });
const activeSpace = () => spaces().find((s) => s.active);
const activeTab = () => activeSpace()?.tabs.find((t) => t.active);
const tabPanes = () => { const t = focused()?.tab; return panes().filter((p) => p.tab === t); };

async function act() {
  // Flip a two-pane tab between side by side and stacked. Panes report no geometry,
  // so remember this tab's last orientation (new splits are assumed side by side).
  const ps = tabPanes();
  if (ps.length !== 2 || ps.some((p) => !p.terminal)) return;
  const key = "old-rotate-split";
  const memo = { ...(shared(key) ?? {}) };
  const tab = ps[0].tab, next = memo[tab] === "down" ? "right" : "down";
  const [a, b] = ps;
  run("pane.focus", { pane: a.pane });
  run("terminal.park", { terminal: b.terminal });
  run("terminal.keep", { terminal: b.terminal, place: next });
  memo[tab] = next;
  setShared(key, memo);
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
