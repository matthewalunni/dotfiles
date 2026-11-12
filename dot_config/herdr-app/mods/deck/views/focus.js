// Which Deck view copy holds which focus handle, so the bar's command loop can
// put the keyboard on a view it just showed. On globalThis (like the
// collector guard): every copy of the mod shares it, and a reloaded build's
// copies register again in their init.

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
