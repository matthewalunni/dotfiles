// Herdr Deck: one mod, several views picked by props().view.
// Each view lives in views/<name>.js and exports a default View class.

import { View, div } from "gpui-kit";
import { props, theme } from "herdr";
import { deckTokens } from "./lib/tokens.js";
import { startCollector, stopCollector } from "./data.js";
import Bar from "./views/bar.js";
import Command from "./views/command.js";
import Issues from "./views/issues.js";
import Confirm from "./views/confirm.js";
import Review from "./views/review.js";
import Machines from "./views/machines.js";
import TermHints from "./views/termhints.js";

const VIEWS = {
  bar: Bar, command: Command, issues: Issues, confirm: Confirm, review: Review,
  machines: Machines, termhints: TermHints,
};

export default class Deck extends View {
  init(p, cx) {
    const view = (props() ?? {}).view;
    // The bar's copy runs the collector (one per app; see data.js).
    if (view === "bar") this.guard = startCollector(cx);
    const Cls = VIEWS[view];
    this.inner = Cls ? cx.new(Cls, p) : null;
  }

  async close() {
    stopCollector(this.guard);
  }

  render(cx) {
    if (!this.inner) {
      const k = deckTokens(theme());
      return div().size_full().p(8).text_size(12).text_color(k.muted).child(`unknown view: ${(props() ?? {}).view}`);
    }
    return div().size_full().child(this.inner);
  }
}
