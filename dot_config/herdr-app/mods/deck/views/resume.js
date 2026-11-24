// Resume for a card whose agent ended: the button (board card, issue overview,
// "Agent not running" side) and the card's session summaries, newest first.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, setShared } from "herdr";
import { resumeIssue, noteResumeFailed, sh } from "../data.js";
import { resumeState, CLICK_MS } from "../lib/board.js";
import { RESUME_CLICKS_KEY } from "../lib/views.js";
import { clockTime } from "../lib/present.js";
import { button, label, act, tokens } from "./ui.js";

// A click in flight is in shared state (RESUME_CLICKS_KEY, part of drawSig),
// not in one view's memory: every view showing this card's button redraws
// when it starts and when it ends. The collector drops clicks past CLICK_MS
// (pruneClicks), so a click whose task was dropped cannot stay busy either.
const clicks = () => shared(RESUME_CLICKS_KEY) ?? {};
function setClick(key, at) {
  const next = { ...clicks() };
  if (at == null) delete next[key];
  else next[key] = at;
  setShared(RESUME_CLICKS_KEY, next);
}

const TOO_LONG = `Resume got no answer in ${CLICK_MS / 1000} s: open the card's terminal, or Resume again`;

/** resumeIssue, or a clear error once CLICK_MS passes, so a click never hangs. (No setTimeout in this runtime: a timed sleep.) */
function resumeBounded(issue) {
  const late = sh("sleep", [String(CLICK_MS / 1000 - 1)], { timeout: CLICK_MS })
    .then(() => ({ ok: false, error: TOO_LONG, late: true }));
  return Promise.race([resumeIssue(issue), late]);
}

/**
 * Resume button for `issue`, or null when it cannot be resumed (lib/board.js
 * resumeState). Reads "Resuming…" (disabled) from the click until the resume
 * ends, CLICK_MS at most: the agent is back (the button goes), or it failed:
 * Resume again, with the reason under it (also a toast).
 * @param {string} id element id @param {any} issue @param {"brand"|"ghost"|"plain"} [kind]
 */
export function resumeButton(id, issue, kind = "brand") {
  const st = resumeState(issue, clicks());
  if (!st) return null;
  if (st.kind === "pending") return button(id, "Resuming…", kind, () => {}, true);
  const k = tokens();
  const btn = button(id, st.error ? "Resume again" : "Resume", kind, (_e, cx) => {
    const key = issue.key;
    setClick(key, Date.now());
    cx.notify();
    act(cx, () => resumeBounded(issue), "Could not resume", (r, cx) => {
      // No answer in time: the card says so (resumeIssue records every other failure itself).
      if (r?.late) noteResumeFailed(key, r.error);
      setClick(key, null);
      cx.notify();
    });
  });
  if (!st.error) return btn;
  return v_flex().items_end().gap(4).max_w(320)
    .child(btn)
    .child(div().text_size(11).line_height(1.35).text_color(k.fail).child(st.error));
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
