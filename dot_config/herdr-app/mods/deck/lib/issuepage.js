// The issue page (deck-issue): what opening an issue does, j/k between issues,
// and where esc goes back to. Pure; no herdr imports.

/** @typedef {import("./store.js").Issue} Issue */
/** @typedef {"board"|"list"|"command"|"terminal"} IssueFrom */

const FROMS = new Set(["board", "list", "command", "terminal"]);
const BACK = {
  board: { child: "deck-issues", label: "← Board" },
  list: { child: "deck-issues", label: "← Issues" },
  command: { child: "deck-command", label: "← Command" },
  terminal: { child: "deck-terminal", label: "← Terminal" },
};

/**
 * What the right side shows: the agent's live terminal, or "gone" (its
 * terminal is not observed any more: draw "Agent not running", focus nothing).
 * @param {Issue|null|undefined} issue @returns {"terminal"|"gone"}
 */
export function issuePane(issue) {
  return issue && issue.observed !== false && issue.terminal ? "terminal" : "gone";
}

/**
 * Opening `issue`'s page: the selection to store, where it came from, the
 * terminal to agent.focus (null when gone) and the stack child to show.
 * @param {Issue|null|undefined} issue @param {string} from
 * @returns {{sel: string, from: IssueFrom, focus: string|null, child: "deck-issue", pane: "terminal"|"gone"}|null}
 */
export function openPlan(issue, from) {
  if (!issue?.key) return null;
  const pane = issuePane(issue);
  return {
    sel: issue.key,
    from: /** @type {IssueFrom} */ (FROMS.has(from) ? from : "list"),
    focus: pane === "terminal" ? issue.terminal : null,
    child: "deck-issue",
    pane,
  };
}

/**
 * The issue `d` steps from `key` in `order`, clamped at both ends (no wrap).
 * A key not in `order` lands on the first issue.
 * @param {Issue[]|null|undefined} order @param {string|null} key @param {number} d
 * @returns {Issue|null}
 */
export function stepIssue(order, key, d) {
  if (!order?.length) return null;
  const at = order.findIndex((i) => i.key === key);
  if (at < 0) return order[0];
  return order[Math.max(0, Math.min(order.length - 1, at + d))];
}

/**
 * Where a page opened now comes from, given the Deck view shown (VIEW_KEY)
 * and the Issues mode. Already on the page, the previous `from` stays.
 * @param {unknown} view @param {unknown} mode @param {unknown} prev
 * @returns {IssueFrom}
 */
export function issueFrom(view, mode, prev) {
  if (view === "deck-issue") return FROMS.has(/** @type {string} */ (prev)) ? /** @type {IssueFrom} */ (prev) : "list";
  if (view === "deck-command") return "command";
  if (view === "deck-terminal") return "terminal";
  return mode === "board" ? "board" : "list";
}

/** esc's target and the breadcrumb's back label. @param {unknown} from */
export function backTarget(from) {
  return { ...(BACK[/** @type {string} */ (from)] ?? BACK.list) };
}
