// The issue page (deck-issue): what opening an issue does, j/k between issues,
// and where esc goes back to. Pure; no herdr imports.

/** @typedef {import("./store.js").Issue} Issue */
/** @typedef {"board"|"list"|"command"|"terminal"} IssueFrom */

const FROMS = new Set(["board", "list", "command", "terminal"]);
const BACK = {
  board: { child: "deck-issues", label: "← Board", focus: true },
  list: { child: "deck-issues", label: "← Issues", focus: true },
  command: { child: "deck-command", label: "← Command", focus: true },
  terminal: { child: "deck-terminal", label: "← Terminal", focus: false },
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
 * stack child to show and the right side ("terminal" | "gone").
 * @param {Issue|null|undefined} issue @param {string} from
 * @returns {{sel: string, from: IssueFrom, child: "deck-issue", pane: "terminal"|"gone"}|null}
 */
export function openPlan(issue, from) {
  if (!issue?.key) return null;
  const pane = issuePane(issue);
  return {
    sel: issue.key,
    from: /** @type {IssueFrom} */ (FROMS.has(from) ? from : "list"),
    child: "deck-issue",
    pane,
  };
}

/**
 * How opening the page shows the issue's terminal: the tab (and space) that
 * holds its agent, to show with space.select + tab.select. Never a focus call:
 * the keyboard stays on the overview until T. {none: true} when the issue is
 * gone or its agent is not in `agents` (agents()).
 * @param {Issue|null|undefined} issue @param {{address: string, tab: string, space: string}[]|null|undefined} agents
 * @returns {{tab: string, space: string}|{none: true}}
 */
export function openTarget(issue, agents) {
  if (issuePane(issue) !== "terminal") return { none: true };
  const a = (agents ?? []).find((x) => x.address === issue.terminal);
  return a?.tab ? { tab: a.tab, space: a.space } : { none: true };
}

/**
 * The right side to show once the agent list is known: "terminal" only when
 * the agent's tab can actually be shown (openTarget), else "gone".
 * @param {Issue|null|undefined} issue @param {{address: string, tab: string, space: string}[]|null|undefined} agents
 * @returns {"terminal"|"gone"}
 */
export function sidePane(issue, agents) {
  return "tab" in openTarget(issue, agents) ? "terminal" : "gone";
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

/**
 * esc's target and the breadcrumb's back label. `focus` is whether going back
 * gives the target the keyboard; false for the Terminal view, so a held esc
 * can't reach (and interrupt) the agent. @param {unknown} from
 */
export function backTarget(from) {
  return { ...(BACK[/** @type {string} */ (from)] ?? BACK.list) };
}
