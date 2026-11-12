// Putting the keyboard on the Deck view that is shown.
// - goTo(child): every way of showing a view (⌥⌘ keys, the bar's nav, the
//   Issues sidebar's Command item, Inspect / ↵) goes through it.
// - focusOnShow(...): Command and Issues call it on each draw; on their first
//   draw (a fresh copy, e.g. after layout.switch to deck) and whenever they
//   come back into sight, they focus their own handle a beat later.
// The handle registry is on globalThis (like the collector guard): every copy
// of the mod shares it, and a reloaded build's copies register again in init.
import { shared, agents, run } from "herdr";
import { showView, VIEW_KEY } from "../data.js";
import { shownChild, takesFocus } from "../lib/views.js";

// The stack child may draw only on the next frame: focus once it has.
const SETTLE_MS = 40;

const reg = () => (globalThis.__deckFocus ??= new Map());

/** @param {string} child the stack child ("deck-command" | "deck-issues") @param {any} handle */
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
export function goTo(child) {
  showView(child);
  if (child === "deck-terminal") return focusAgent();
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
