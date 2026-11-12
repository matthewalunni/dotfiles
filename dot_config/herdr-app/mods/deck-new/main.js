// Herdr Deck: New task from anywhere. keys.json's global ⌘⇧N runs
// `mod.open:deck-new`; this opens Deck's own New task dialog (deck's
// views/newtask.js, the one N and + New task open) and closes itself, the way
// the old-* mods open shipped dialogs.
//
// Why a hop and not the dialog itself: a mod can't import another mod's files
// (Herdr refuses any module that resolves outside the mod's folder, `../deck/`,
// a symlink or an absolute path alike), and `mod.open` takes no props. Opening
// the `deck` mod as the dialog keeps one dialog and no copied code. The dialog
// picks its own repo (the selected issue's) and refuses to open over another
// Deck dialog.
import { View, div } from "gpui-kit";
import { props, closeOverlay, openOverlay, notify } from "herdr";

export default class DeckNew extends View {
  init(_props, cx) {
    const overlay = props()?.overlay;
    if (!overlay) return; // `herdr-app check` renders without an overlay: do nothing there
    cx.spawn(async () => {
      try {
        openOverlay({ mod: "deck", props: { view: "newtask" }, kind: "dialog", modal: true, width: 640 });
      } catch (e) {
        notify({ title: "New task", body: String(e?.message ?? e), level: "warning" });
      }
      closeOverlay(overlay);
    });
  }

  render() {
    return div();
  }
}
