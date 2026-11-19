// Herdr Deck: one mod, several views picked by props().view.
// Each view lives in views/<name>.js and exports a default View class.

import { View, div } from "gpui-kit";
import { props, theme } from "herdr";
import { deckTokens } from "./lib/tokens.js";
import { startCollector, stopCollector } from "./data.js";
import { startChat, stopChat } from "./chat.js";
import Bar from "./views/bar.js";
import Command from "./views/command.js";
import Chat from "./views/chat.js";
import Issues from "./views/issues.js";
import Confirm from "./views/confirm.js";
import StartConfirm from "./views/startconfirm.js";
import Remove from "./views/remove.js";
import NewTask from "./views/newtask.js";
import Review from "./views/review.js";
import Machines from "./views/machines.js";
import TermHints from "./views/termhints.js";
import Keys from "./views/keys.js";
import IssuePage, { ThreadView, GoneView, IssueHints } from "./views/issuepage.js";

const VIEWS = {
  bar: Bar, command: Command, chat: Chat, issues: Issues, confirm: Confirm, startconfirm: StartConfirm, remove: Remove, newtask: NewTask, review: Review,
  machines: Machines, termhints: TermHints, keys: Keys,
  issue: IssuePage, thread: ThreadView, issuegone: GoneView, issuehints: IssueHints,
};

export default class Deck extends View {
  init(p, cx) {
    const view = (props() ?? {}).view;
    // The bar's copy runs the collector and the chat source (one per app; see data.js, chat.js).
    if (view === "bar") {
      this.guard = startCollector(cx);
      this.chatGuard = startChat(cx);
    }
    const Cls = VIEWS[view];
    this.inner = Cls ? cx.new(Cls, p) : null;
  }

  async close() {
    stopCollector(this.guard);
    stopChat(this.chatGuard);
  }

  render(cx) {
    if (!this.inner) {
      const k = deckTokens(theme());
      return div().size_full().p(8).text_size(12).text_color(k.muted).child(`unknown view: ${(props() ?? {}).view}`);
    }
    return div().size_full().child(this.inner);
  }
}
