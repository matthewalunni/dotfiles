// Resume for a card whose agent ended: the button (board card, issue overview,
// "Agent not running" side) and the card's session summaries, newest first.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { resumeIssue, sh } from "../data.js";
import { canResume, resuming } from "../lib/board.js";
import { clockTime } from "../lib/present.js";
import { button, label, act } from "./ui.js";

// Clicks still running, by card key: the button reads "Resuming…" from the
// click on, not only once the card is relinked. Shared by every Deck view.
const clicking = (globalThis.__deckResumeClicks ??= new Map());
// A click gives up after this (resumeIssue's own steps are each timed, well inside it).
const CLICK_MS = 25_000;

/** resumeIssue, or a clear error once CLICK_MS passes, so a click never hangs. (No setTimeout in this runtime: a timed sleep.) */
function resumeBounded(issue) {
  const late = sh("sleep", [String(CLICK_MS / 1000)], { timeout: CLICK_MS + 2000 })
    .then(() => ({ ok: false, error: "Resume took too long: try again, or open the card's terminal" }));
  return Promise.race([resumeIssue(issue), late]);
}

/**
 * Resume button for `issue`, or null when it cannot be resumed. Reads
 * "Resuming…" (disabled) from the click until the resume ends: the agent is
 * back, or it failed (a toast says why) and Resume shows again.
 * @param {string} id element id @param {any} issue @param {"brand"|"ghost"|"plain"} [kind]
 */
export function resumeButton(id, issue, kind = "brand") {
  const at = clicking.get(issue?.key);
  if ((at != null && Date.now() - at < CLICK_MS) || resuming(issue)) return button(id, "Resuming…", kind, () => {}, true);
  if (!canResume(issue)) return null;
  return button(id, "Resume", kind, (_e, cx) => {
    clicking.set(issue.key, Date.now());
    cx.notify();
    act(cx, () => resumeBounded(issue), "Could not resume", (_r, cx) => {
      clicking.delete(issue.key);
      cx.notify();
    });
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (t) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${clockTime(t)}`;
};

/**
 * "Where it stopped": each ended run's summary, newest first. null when none.
 * @param {any} issue @param {any} k tokens @param {number} [max]
 */
export function sessionLog(issue, k, max = 6) {
  const all = Array.isArray(issue?.summaries) ? issue.summaries : [];
  if (!all.length) return null;
  const rows = all.slice(-max).reverse();
  return v_flex()
    .gap(8)
    .child(label("Where it stopped"))
    .children(
      rows.map((s, n) =>
        v_flex()
          .gap(5)
          .p(12)
          .rounded(10)
          .bg(n === 0 ? k.wash : k.bg)
          .border_1()
          .border_color(k.hair)
          .line_height(1.5)
          .child(h_flex().gap(8).text_size(11).text_color(k.muted)
            .child(div().child("Ended " + day(s.t)))
            .child(div().flex_1())
            .child(div().font_family("JetBrains Mono").child(String(s.session ?? "").slice(0, 8))))
          .child(div().text_color(k.strong).child(String(s.done ?? "")))
          .child(div().text_color(k.muted).child(String(s.stopped ?? "")))
          .when(Boolean(s.question), (el) => el.child(div().text_color(k.hold).child("Open question: " + s.question))),
      ),
    );
}
