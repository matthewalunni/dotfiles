// Review cost: how much of Matt a card's result needs. Pure; no herdr imports.
// "needs-me": a significant change, design judgment, or anything he must watch.
// "unattended": research, prototypes, small maintenance, anything fully checked
// by tests and the proof file. A card without a value reads as "needs-me".

/** @typedef {"needs-me"|"unattended"} Review */

export const REVIEWS = /** @type {Review[]} */ (["needs-me", "unattended"]);
export const REVIEW_LABEL = { "needs-me": "Needs me", unattended: "Unattended" };
/** Shared key: whether the Issues list and board put unattended cards first. */
export const REVIEW_SORT_KEY = "deck.reviewSort";

/**
 * A review cost from what was typed or stored ("needs-me", "needs me",
 * "unattended", "safe unattended", any case), or null.
 * @param {unknown} v @returns {Review|null}
 */
export function asReview(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "needs-me") return "needs-me";
  if (s === "unattended" || s === "safe-unattended") return "unattended";
  return null;
}

/** A card's review cost; no value (every card from before the field) is "needs-me". @param {any} issue @returns {Review} */
export function reviewOf(issue) {
  return issue?.review === "unattended" ? "unattended" : "needs-me";
}

/** The other value (the U key). @param {any} issue @returns {Review} */
export function otherReview(issue) {
  return reviewOf(issue) === "unattended" ? "needs-me" : "unattended";
}

/** Sort order with the cheap cards first: unattended, then needs-me. */
export function reviewOrder(a, b) {
  return Number(reviewOf(a) !== "unattended") - Number(reviewOf(b) !== "unattended");
}
