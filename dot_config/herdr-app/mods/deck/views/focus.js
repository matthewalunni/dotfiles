// Putting the keyboard on the Deck view that is shown.
// - goTo(child): every way of showing a view (⌥⌘ keys, the bar's nav, the
//   Issues sidebar's Command item, Inspect / ↵) goes through it.
// - openIssue(issue, from): every way of opening the issue page.
// - focusOnShow(...): Command, Issues and the issue page call it on each draw; on their first
//   draw (a fresh copy, e.g. after layout.switch to deck) and whenever they
//   come back into sight, they focus their own handle a beat later.
// The handle registry is on globalThis (like the collector guard): every copy
// of the mod shares it, and a reloaded build's copies register again in init.
import { shared, setShared, agents, focused, run } from "herdr";
import { showView, VIEW_KEY, SEL_KEY, TAB_KEY, MODE_KEY, ISSUE_FROM_KEY } from "../data.js";
import { shownChild, takesFocus } from "../lib/views.js";
import { openPlan, openTarget, sidePane, issueFrom } from "../lib/issuepage.js";

// The stack child may draw only on the next frame: focus once it has.
const SETTLE_MS = 40;

const reg = () => (globalThis.__deckFocus ??= new Map());

/** @param {string} child the stack child ("deck-command" | "deck-issues" | "deck-issue") @param {any} handle */
export function registerFocus(child, handle) {
  reg().set(child, handle);
}

/** Moves the keyboard onto that view, when one registered. */
export function focusView(child) {
  try {
    reg().get(child)?.focus();
  } catch {
    // its copy closed: nothing to focus
  }
}

/** The focused agent's terminal address, or null. */
export const focusedAgent = () => (agents() ?? []).find((a) => a.focused)?.address ?? null;

/** Gives the Terminal view's agent block the keyboard. */
export function focusAgent() {
  const t = focusedAgent();
  if (t) run("agent.focus", { terminal: t });
}

/**
 * Shows a Deck view and puts the keyboard on it (Command / Issues: their
 * handle, now and again from their own focusOnShow once drawn; Terminal: the
 * agent). No timer of its own: one here would race R's reply-box focus.
 */
export function goTo(child, { agent = true } = {}) {
  showView(child);
  if (child === "deck-terminal") return agent ? focusAgent() : undefined;
  focusView(child);
}

/**
 * Called from a Deck view's render: when `child` has just come into sight,
 * runs `take` (focus its handle) a beat later. Keeps what it saw on `view`.
 * @param {any} view the View (holds .lastShow) @param {string} child @param {() => void} take
 */
export function focusOnShow(view, child, take, cx) {
  const now = shownChild(shared("layout"), shared(VIEW_KEY));
  const ask = globalThis.__deckShown ?? null;
  const last = view.lastShow ?? { shown: null, ask: null };
  view.lastShow = { shown: now, ask };
  if (!takesFocus(last, now, ask, child, Date.now())) return;
  cx.timer.after(SETTLE_MS, () => {
    try {
      take();
    } catch {
      // closed meanwhile
    }
  });
}

/** The issue page's right side: the live pane, or "Agent not running" (deck-issue-side stack). */
export function showIssueSide(pane) {
  run("layout.select", { stack: "deck-issue-side", child: pane === "terminal" ? "deck-issue-pane" : "deck-issue-gone" });
}

/**
 * Opens the issue page for `issue`: selects it, records where it was opened
 * from (`from`, or worked out from the view shown when omitted), shows its
 * agent's tab with space.select + tab.select when its terminal is observed
 * (nothing when it is gone), and puts the keyboard on the overview (goTo).
 * Never agent.focus / pane.focus: only T gives the terminal the keyboard, so a
 * digit pressed right after opening can't answer a prompt in the terminal.
 * @param {any} issue @param {"board"|"list"|"command"|"terminal"} [from]
 */
export function openIssue(issue, from) {
  const f = from ?? issueFrom(shared(VIEW_KEY), shared(MODE_KEY), shared(ISSUE_FROM_KEY));
  const plan = openPlan(issue, f);
  if (!plan) return;
  setShared(SEL_KEY, plan.sel);
  setShared(TAB_KEY, "overview");
  setShared(ISSUE_FROM_KEY, plan.from);
  const t = openTarget(issue, agents());
  showIssueSide(sidePane(issue, agents()));
  if ("tab" in t) {
    if (t.space && focused()?.space !== t.space) run("space.select", { id: t.space });
    run("tab.select", { id: t.tab });
  }
  goTo(plan.child);
}
