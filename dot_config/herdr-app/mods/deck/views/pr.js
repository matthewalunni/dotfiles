// The Pull request tab: header, file list + checks, the diff from `gh pr diff`
// and a merge bar. Drawn inside the Issues view; `host` is that view (it owns
// the busy flag and the diff's scroll handle).
import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { exec } from "herdr";
import { parseDiff } from "../lib/github.js";
import { diffRows, checkTally } from "../lib/present.js";
import { openUrl, markDiffReviewed } from "../data.js";
import { tokens, label, heading, chip, dot, segments, act } from "./ui.js";
import { lockOf, mergeButtons } from "./merge.js";

const DIFF_TIMEOUT = 15_000;
const LINE_CAP = 1500;
const CACHE_MAX = 8;

/** diff key -> { rows, sizes, fileRow, paths, truncated } | { error } */
const cache = new Map();
/** diff keys being fetched (one fetch per key across copies). */
const loading = new Set();

const diffKey = (issue) => `${issue.root}#${issue.pr.number}@${issue.pr.headSha ?? "c" + issue.pr.commits}`;

function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function fetchDiff(issue, key, cx) {
  if (loading.has(key)) return;
  loading.add(key);
  const n = String(issue.pr.number);
  const root = issue.root;
  cx.spawn(async (cx) => {
    try {
      const r = await exec("gh", ["pr", "diff", n], { cwd: root, timeout: DIFF_TIMEOUT });
      if (r.code !== 0) {
        remember(key, { error: String(r.stderr || r.stdout || "gh pr diff failed").trim().split("\n")[0] });
      } else {
        const files = parseDiff(String(r.stdout ?? ""));
        remember(key, { ...diffRows(files, LINE_CAP), paths: files.map((f) => f.path) });
      }
    } catch (e) {
      remember(key, { error: String(e?.message ?? e) });
    } finally {
      loading.delete(key);
    }
    cx.notify();
  });
}

function diffRow(row, k, pr) {
  switch (row.kind) {
    case "file":
      return h_flex()
        .w_full()
        .h(32)
        .flex_none()
        .items_center()
        .gap(10)
        .px(12)
        .bg(k.panel)
        .border_t(1)
        .border_b(1)
        .border_color(k.line)
        .child(div().flex_1().min_w(0).truncate().text_color(k.strong).child(row.path))
        .child(div().flex_none().text_color(k.ok).child("+" + row.add))
        .child(div().flex_none().text_color(k.fail).child("−" + row.del));
    case "hunk":
      return div().w_full().h(22).flex_none().flex().items_center().px(12).bg(k.raised).text_color(k.muted).truncate().child(row.text);
    case "truncated":
      return h_flex()
        .id("diff-truncated")
        .w_full()
        .h(32)
        .flex_none()
        .items_center()
        .px(12)
        .border_t(1)
        .border_color(k.line)
        .text_color(k.nodata)
        .cursor_pointer()
        .hover((s) => s.bg(k.raised))
        .on_click((_e, cx) => act(cx, () => openUrl(pr.url), "Could not open GitHub"))
        .child("Diff truncated — open in GitHub ↗");
    default: {
      const add = row.sign === "+";
      const del = row.sign === "-";
      return h_flex()
        .w_full()
        .h(20)
        .flex_none()
        .items_center()
        .when(add, (el) => el.bg(k.addBg))
        .when(del, (el) => el.bg(k.delBg))
        .child(div().w(44).flex_none().pr(8).text_right().text_color(k.muted).child(row.a == null ? "" : String(row.a)))
        .child(div().w(44).flex_none().pr(8).text_right().text_color(k.muted).child(row.b == null ? "" : String(row.b)))
        .child(div().w(16).flex_none().text_color(add ? k.ok : del ? k.fail : k.muted).child(add ? "+" : del ? "−" : ""))
        .child(div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().text_color(add || del ? k.strong : k.text).child(row.code || " "));
    }
  }
}

/**
 * @param {any} host the Issues view
 * @param {any} issue an issue with a PR
 * @param {any} k tokens
 * @param {any} cx render cx
 * @param {(el: any) => any} withTabs adds the detail tabs row to the header
 */
export function prTab(host, issue, k, cx, withTabs) {
  const pr = issue.pr;
  const key = diffKey(issue);
  const diff = cache.get(key);
  if (!diff && issue.root) fetchDiff(issue, key, cx);

  const tally = checkTally(pr.checks);
  const files = pr.files ?? [];
  const stateChip = pr.state === "OPEN" ? chip("OPEN", k.ok, k.okBg) : pr.state === "MERGED" ? chip("MERGED", k.brand, k.raised) : chip("CLOSED", k.fail, k.raised);
  const checkColor = (s) => (s === "pass" ? k.ok : s === "fail" ? k.fail : k.nodata);

  const header = withTabs(
    v_flex()
      .flex_none()
      .px(20)
      .pt(16)
      .gap(10)
      .child(
        h_flex()
          .items_center()
          .gap(12)
          .child(heading(pr.title, 26).flex_shrink(1).min_w(0).truncate())
          .child(div().flex_none().text_color(k.muted).child("#" + pr.number))
          .child(stateChip),
      )
      .child(
        h_flex()
          .items_center()
          .gap(16)
          .text_color(k.muted)
          .child(div().flex_shrink(1).min_w(0).truncate().child(`${pr.head} → ${pr.base}`))
          .child(div().flex_none().child(`${pr.commits} commit${pr.commits === 1 ? "" : "s"}`))
          .child(
            h_flex()
              .flex_none()
              .gap(6)
              .child(`${files.length} file${files.length === 1 ? "" : "s"}`)
              .child(div().text_color(k.ok).child("+" + pr.additions))
              .child(div().text_color(k.fail).child("−" + pr.deletions)),
          )
          .child(div().flex_1())
          .child(div().flex_none().child("checks"))
          .child(
            h_flex()
              .w(160)
              .flex_none()
              .child(segments(tally.total ? pr.checks.map((c) => checkColor(c.status)) : [k.line, k.line, k.line, k.line])),
          )
          .child(div().flex_none().text_color(k.text).child(`${tally.pass}/${tally.total}`)),
      ),
  );

  // Left: files then checks.
  const fileRowOf = (path) => {
    if (!diff || diff.error) return -1;
    const i = diff.paths.indexOf(path);
    return i < 0 ? -1 : diff.fileRow[i];
  };
  const fileList = v_flex()
    .id("pr-files")
    .w(250)
    .flex_none()
    .h_full()
    .border_r(1)
    .border_color(k.line)
    .py(12)
    .gap(2)
    .overflow_y_scrollbar()
    .children(
      files.map((f) => {
        const at = fileRowOf(f.path);
        return h_flex()
          .id("pr-file-" + f.path)
          .flex_none()
          .items_center()
          .gap(8)
          .px(16)
          .py(7)
          .when(at >= 0, (el) => el.cursor_pointer().hover((s) => s.bg(k.raised)).on_click(() => host.diffScroll.scroll_to_item(at, "top")))
          .child(dot(f.add && !f.del ? k.ok : f.del && !f.add ? k.fail : k.brand, 6))
          .child(div().flex_1().min_w(0).truncate().text_color(k.text).child(f.path.split("/").pop()))
          .child(div().flex_none().text_color(k.ok).child("+" + f.add))
          .child(div().flex_none().text_color(k.fail).child("−" + f.del));
      }),
    )
    .child(
      v_flex()
        .flex_none()
        .mx(16)
        .mt(14)
        .pt(12)
        .border_t(1)
        .border_color(k.line)
        .gap(6)
        .child(label("Checks"))
        .when(!tally.total, (el) => el.child(div().text_color(k.muted).child("No CI checks")))
        .children(
          (pr.checks ?? []).map((c) =>
            h_flex()
              .gap(8)
              .child(div().w(12).flex_none().text_color(checkColor(c.status)).child(c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "●"))
              .child(div().flex_1().min_w(0).truncate().child(c.name))
              .child(div().flex_none().text_color(k.muted).child(c.detail || "")),
          ),
        ),
    );

  // Diff.
  let diffArea;
  if (!issue.root) diffArea = div().p(16).text_color(k.muted).child("Not a git repo");
  else if (!diff) diffArea = div().p(16).text_color(k.muted).child("Loading diff…");
  else if (diff.error) {
    diffArea = v_flex()
      .p(16)
      .gap(8)
      .child(div().text_color(k.fail).child("Could not load the diff: " + diff.error))
      .child(
        div()
          .id("diff-retry")
          .text_color(k.brand)
          .cursor_pointer()
          .on_click((_e, cx) => {
            cache.delete(key);
            cx.notify();
          })
          .child("Try again"),
      );
  } else if (!diff.rows.length) diffArea = div().p(16).text_color(k.muted).child("No changes in the diff.");
  else {
    const rows = diff.rows;
    diffArea = div()
      .flex_1()
      .min_h(0)
      .relative()
      .child(
        v_virtual_list("pr-diff-" + pr.number, rows.length, diff.sizes, (i) => String(i), (range) =>
          rows.slice(range.start, range.end).map((row) => diffRow(row, k, pr)),
        )
          .track_scroll(host.diffScroll)
          .size_full(),
      )
      .child(Scrollbar.vertical("pr-diff-" + pr.number).absolute().inset_0());
    // The diff for this head is on screen now (the cache key carries headSha):
    // record it for the review soft gate. Deferred, so render doesn't write state.
    const head = pr.headSha;
    if (head && issue.reviewedSha !== head) cx.spawn(async () => markDiffReviewed(issue, head));
  }

  // Merge bar.
  const m = lockOf(issue);
  const open = pr.state === "OPEN";
  const headline = !open ? (pr.state === "MERGED" ? "Merged" : "Closed without merging")
    : m.canMerge ? "Every claim passes"
    : m.reasons.length ? m.reasons.join(" · ")
    : issue.ghError ? "GitHub unavailable" : "Merge is locked";
  const sub = !open ? "Nothing to merge"
    : m.canMerge ? "Squash merge on press"
    : m.showAnyway ? "Merge stays locked until every claim passes. Merge anyway asks first."
    : "Deck retries GitHub on its next poll.";
  const bar = h_flex()
    .flex_none()
    .items_center()
    .gap(12)
    .px(20)
    .py(14)
    .border_t(1)
    .border_color(k.line)
    .bg(open && !m.canMerge ? k.holdBg : k.panel)
    .child(dot(!open ? k.muted : m.canMerge ? k.ok : k.nodata, 10, true))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(2)
        .child(div().text_color(k.strong).truncate().child(headline))
        .child(div().text_color(k.muted).truncate().child(sub)),
    )
    .children(mergeButtons(host, issue, "prbar"));

  return v_flex()
    .flex_1()
    .min_h(0)
    .child(header)
    .child(
      h_flex()
        .flex_1()
        .min_h(0)
        .items_stretch()
        .child(fileList)
        .child(v_flex().flex_1().min_w(0).h_full().child(v_flex().flex_1().min_h(0).px(16).py(12).child(diffArea)).child(bar)),
    );
}
