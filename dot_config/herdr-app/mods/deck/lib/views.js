// Which Deck stack child is on screen, and when a view has just come into
// sight (so it takes the keyboard). Pure; no herdr imports.

const CHILDREN = ["deck-chat", "deck-issues", "deck-issue", "deck-terminal", "deck-goals"];

/**
 * The child the deck-main stack shows, or null outside a Deck layout.
 * A stale or unknown view (e.g. "deck-work" from v1) counts as Chat.
 * @param {unknown} layout shared("layout") @param {unknown} view shared(VIEW_KEY)
 * @returns {string|null}
 */
export function shownChild(layout, view) {
  if (!String(layout ?? "").startsWith("deck")) return null;
  return CHILDREN.includes(/** @type {string} */ (view)) ? /** @type {string} */ (view) : "deck-chat";
}

/** How long a show request (showView) may wait for the view's next draw. */
export const ASK_MS = 1500;

/**
 * Whether `child`'s copy takes the keyboard on this draw: it is shown now, and
 * either it was not on its last draw (its first draw counts: a fresh copy, e.g.
 * after layout.switch to deck), or a show request for it (`ask`, set by
 * showView) is new since then and recent. Hidden stack children may not draw,
 * so `last.shown` alone can miss a return; the request catches that.
 * @param {{ shown: string|null, ask: any }} last what this copy saw on its last draw
 * @param {string|null} now shownChild(...) now
 * @param {{ child: string, at: number }|null|undefined} ask the latest show request
 * @param {string} child this copy's stack child
 * @param {number} ms Date.now()
 */
export function takesFocus(last, now, ask, child, ms) {
  if (now !== child) return false;
  if (last.shown !== child) return true;
  return Boolean(ask && ask !== last.ask && ask.child === child && ms - ask.at < ASK_MS);
}

const NAV = ["deck-chat", "deck-issues", "deck-terminal", "deck-goals"];

/**
 * The bar nav item to underline for a VIEW_KEY: the issue page is Issues; a
 * stale or unknown view is Chat.
 * @param {unknown} view @returns {string}
 */
export function navChild(view) {
  if (view === "deck-issue") return "deck-issues";
  return NAV.includes(/** @type {string} */ (view)) ? /** @type {string} */ (view) : "deck-chat";
}

const SIG_KEYS = ["layout", "deck.view", "deck.selected", "deck.issueTab", "deck.issuesMode", "deck.issueFrom", "deck.goals"];

/**
 * A cheap fingerprint of what a Deck view draws from: the shown layout and
 * view, the selection, tab, mode and where the page came from, and the store's
 * size and last event. Two draws with the same fingerprint look the same as
 * far as navigation goes. `get` is shared().
 * @param {(key: string) => any} get @returns {string}
 */
export function drawSig(get) {
  const s = get("deck.store");
  const last = s?.log?.at?.(-1);
  return JSON.stringify([...SIG_KEYS.map((k) => get(k) ?? null), s?.issues?.length ?? 0, s?.log?.length ?? 0, last?.t ?? 0, last?.key ?? null]);
}
