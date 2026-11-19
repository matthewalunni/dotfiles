// The Chat view's rich cards: GitHub (a PR: number, title, checks, merge state)
// and Deck (an issue or backlog card: stage, time held, its prompt options,
// Start / Discard for a backlog entry). Registered in chatblocks.js.
//
// A PR that belongs to a deck issue is read from the store. Any other PR is
// fetched once (gh pr view <n>) and kept in memory by number; a failed fetch
// draws the number alone and is not retried.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checkTally, minutesSince, issueNote } from "../lib/present.js";
import { PR_FIELDS, parsePr } from "../lib/github.js";
import { STAGE_LABEL } from "../lib/stage.js";
import { currentStore, sh, openUrl, pressOption, discardEntry } from "../data.js";
import { tone, stageColor, button, dot, act } from "./ui.js";
import { optionButton } from "./issues.js";
import { startKey } from "./startconfirm.js";
import { openIssue } from "./focus.js";

const T_GH = 15_000;

/** PR number -> { state: "loading" } | { state: "ok", pr } | { state: "failed" }. */
const prCache = new Map();
/** Numbers a card asked for since the last fetchPrs. */
const wanted = new Set();

/** Whether a card asked for a PR that is not fetched yet. */
export const prsWanted = () => wanted.size > 0;

/** Starts a fetch for each asked-for PR (once per number). Call outside render. */
export function fetchPrs(cx) {
  for (const n of wanted) {
    if (prCache.has(n)) continue;
    prCache.set(n, { state: "loading" });
    cx.spawn(async (cx) => {
      let entry = { state: "failed" };
      try {
        const r = await sh("gh", ["pr", "view", String(n), "--json", PR_FIELDS], { timeout: T_GH });
        const { pr } = parsePr(r);
        if (pr) entry = { state: "ok", pr };
      } catch {
        // no PR: the card shows the number alone
      }
      prCache.set(n, entry);
      cx.notify();
    });
  }
  wanted.clear();
}

/** The PR for a github card: the store's (its issue's), else the fetched copy. */
function prFor(block) {
  const issue = block.issueKey ? currentStore().issues.find((i) => i.key === block.issueKey) : null;
  if (issue?.pr?.number === block.number) return { state: "ok", pr: issue.pr };
  const got = prCache.get(block.number);
  if (!got) wanted.add(block.number);
  return got ?? { state: "loading" };
}

/** "merged" / "closed" / the review word / "open", with its color. */
function mergeState(pr, k) {
  if (pr.state === "MERGED") return { text: "merged", color: k.ok };
  if (pr.state === "CLOSED") return { text: "closed", color: k.muted };
  if (pr.review === "APPROVED") return { text: "approved", color: k.ok };
  if (pr.review === "CHANGES_REQUESTED") return { text: "changes requested", color: k.fail };
  return { text: "open", color: k.text };
}

const card = (k) => h_flex().w_full().items_center().gap(10).px(12).py(10).bg(k.panel).border_1().border_color(k.line).rounded(8);

/** A `github` block: { number, issueKey }. */
export function githubCard(block, _cx, { k }) {
  const got = prFor(block);
  const el = card(k)
    .id("chat-gh-" + block.id)
    .child(svg("mods/deck/icons/pr.svg").flex_none().w(14).h(14).text_color(k.text))
    .child(div().flex_none().text_color(k.brand).child("#" + block.number));
  if (got.state !== "ok") {
    return el.when(got.state === "loading", (e) => e.child(div().text_color(k.muted).child("loading…")));
  }
  const pr = got.pr;
  const t = checkTally(pr.checks);
  const m = mergeState(pr, k);
  return el
    .when(Boolean(pr.url), (e) =>
      e.cursor_pointer().hover((s) => s.bg(k.raised)).on_click((_e, cx) => act(cx, () => openUrl(pr.url), "Could not open GitHub")),
    )
    .child(div().flex_1().min_w(0).truncate().text_color(k.strong).child(pr.title || "untitled"))
    .child(
      h_flex()
        .flex_none()
        .items_center()
        .gap(6)
        .text_color(k.muted)
        .child(dot(tone(t.tone, k), 7, true))
        .child(t.total ? `checks ${t.pass}/${t.total}` : "no checks"),
    )
    .child(div().flex_none().text_color(m.color).child(m.text));
}

/** A stage chip, outlined in the stage's color. */
function stageChip(issue, k) {
  const c = issue.discarded ? k.muted : stageColor(issue.stage, k);
  const word = issue.discarded ? "Discarded" : STAGE_LABEL[issue.stage] ?? issue.stage;
  return div().flex_none().px(7).py(1).border_1().border_color(c).text_size(11).text_color(c).child(String(word).toUpperCase());
}

/** Time held (holding), age (backlog), else the issue's one-line note. */
function since(issue, now) {
  if (issue.stage === "holding") return `held ${minutesSince(issue.holdingSince, now)}m`;
  if (issue.kind === "backlog") return `filed ${minutesSince(issue.createdAt, now)}m ago`;
  return issueNote(issue);
}

/** A `deck` block: { issueKey }. */
export function deckCard(block, _cx, { k, host }) {
  const issue = currentStore().issues.find((i) => i.key === block.issueKey);
  if (!issue) return card(k).text_color(k.muted).child(`${block.issueKey} · no longer on the board`);
  const busy = Boolean(host.busy);
  const head = h_flex()
    .id("chat-deck-" + block.id)
    .w_full()
    .items_center()
    .gap(10)
    .cursor_pointer()
    .on_click(() => openIssue(issue, "chat"))
    .child(stageChip(issue, k))
    .child(div().flex_none().text_color(k.muted).child(issue.id))
    .child(div().flex_1().min_w(0).truncate().text_color(k.strong).child(issue.title || "untitled"))
    .child(div().flex_none().max_w(220).truncate().text_color(issue.stage === "holding" ? k.hold : k.muted).child(since(issue, Date.now())));
  const body = v_flex().w_full().gap(10).px(12).py(10).bg(k.panel).border_1().border_color(issue.stage === "holding" ? k.hold : k.line).rounded(8).child(head);

  const p = issue.prompt;
  const asks = issue.kind !== "backlog" && issue.observed !== false && p && p.kind !== "none" && (p.options ?? []).length;
  if (asks) {
    body.child(
      v_flex().gap(6).children(
        p.options.map((o, n) =>
          optionButton(`chat-opt-${block.id}-${n}`, o.label, false, (_e, cx) => host.run(cx, () => pressOption(issue, o), "Could not answer"), busy).w_full(),
        ),
      ),
    );
  }
  if (issue.kind === "backlog" && !issue.discarded) {
    body.child(
      h_flex()
        .gap(8)
        .child(button(`chat-start-${block.id}`, "Start agent", "brand", () => startKey(host, issue), busy))
        .child(button(`chat-discard-${block.id}`, "Discard", "plain", () => discardEntry(issue), busy)),
    );
  }
  return body;
}
