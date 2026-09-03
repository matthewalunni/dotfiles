#!/usr/bin/env zsh
# Test harness for reclaim-disk. Run: zsh tests/reclaim-disk.test.zsh
emulate -L zsh
setopt err_return no_unset pipe_fail

SCRIPT_DIR="${0:A:h}"
RECLAIM="$SCRIPT_DIR/../dot_local/bin/executable_reclaim-disk"

typeset -gi PASS=0 FAIL=0

ok()   { print -P "%F{green}✓%f $1"; (( ++PASS )); }
no()   { print -P "%F{red}✗%f $1"; (( ++FAIL )); }
check() { if eval "$2"; then ok "$1"; else no "$1 — failed: $2"; fi }

# A fake XcodeBuildMCP workspace root with `n` runs in each capped category.
# Runs are stamped a day apart so "newest" is unambiguous.
make_workspaces() {
  local root n i stamp
  root="$(mktemp -d)"; root="${root:A}"
  n=$1
  for ws in repvault-aaaa other-bbbb; do
    for cat in test-products result-bundles logs; do
      mkdir -p "$root/workspaces/$ws/$cat"
    done
    mkdir -p "$root/workspaces/$ws/locks"
    for (( i = 1; i <= n; i++ )); do
      stamp=$(printf '202609%02d0000' $i)
      mkdir -p "$root/workspaces/$ws/test-products/run$i.xctestproducts/Build"
      print -- ok > "$root/workspaces/$ws/test-products/run$i.xctestproducts.xcodebuildmcp-completed"
      mkdir -p "$root/workspaces/$ws/result-bundles/run$i.xcresult"
      print -- log > "$root/workspaces/$ws/logs/run$i.log"
      touch -t "$stamp" \
        "$root/workspaces/$ws/test-products/run$i.xctestproducts" \
        "$root/workspaces/$ws/test-products/run$i.xctestproducts.xcodebuildmcp-completed" \
        "$root/workspaces/$ws/result-bundles/run$i.xcresult" \
        "$root/workspaces/$ws/logs/run$i.log"
    done
  done
  print -- "$root"
}

# A DerivedData root with one stale and one fresh build dir.
make_derived() {
  local root
  root="$(mktemp -d)"; root="${root:A}"
  mkdir -p "$root/RepVault-oldhash" "$root/RepVault-newhash"
  touch -t 202601010000 "$root/RepVault-oldhash"
  touch "$root/RepVault-newhash"
  print -- "$root"
}

run() {  # run <xcbmcp-root> <derived-root> [args...]
  local x=$1 d=$2; shift 2
  RECLAIM_XCBMCP_ROOT="$x" RECLAIM_DERIVED_ROOT="$d" RECLAIM_SKIP_PACKAGES=1 \
    bash "$RECLAIM" "$@" 2>&1
}

count() { print -- ${#$(ls -1 "$1" 2>/dev/null)[@]} }

# ---------------------------------------------------------------- report only
X=$(make_workspaces 8); D=$(make_derived)
out=$(run "$X" "$D")
check "bare run keeps every test-products run" \
  "[[ \$(ls -1d $X/workspaces/repvault-aaaa/test-products/*.xctestproducts | wc -l) -eq 8 ]]"
check "bare run keeps stale DerivedData" "[[ -d $D/RepVault-oldhash ]]"
check "bare run says it changed nothing" "print -r -- ${(q)out} | grep -qi 'report only'"
check "bare run reports reclaimable bytes" "print -r -- ${(q)out} | grep -qiE 'test-products'"
rm -rf "$X" "$D"

# ------------------------------------------------------------------- --apply
X=$(make_workspaces 8); D=$(make_derived)
run "$X" "$D" --apply -y >/dev/null
check "keeps exactly 5 test-products runs" \
  "[[ \$(ls -1d $X/workspaces/repvault-aaaa/test-products/*.xctestproducts | wc -l) -eq 5 ]]"
check "keeps the newest run" "[[ -d $X/workspaces/repvault-aaaa/test-products/run8.xctestproducts ]]"
check "drops the oldest run" "[[ ! -d $X/workspaces/repvault-aaaa/test-products/run1.xctestproducts ]]"
check "drops the completed marker with its run" \
  "[[ ! -e $X/workspaces/repvault-aaaa/test-products/run1.xctestproducts.xcodebuildmcp-completed ]]"
check "keeps the completed marker of a surviving run" \
  "[[ -e $X/workspaces/repvault-aaaa/test-products/run8.xctestproducts.xcodebuildmcp-completed ]]"
check "caps result-bundles at 5" \
  "[[ \$(ls -1 $X/workspaces/repvault-aaaa/result-bundles | wc -l) -eq 5 ]]"
check "caps logs at 5" "[[ \$(ls -1 $X/workspaces/repvault-aaaa/logs | wc -l) -eq 5 ]]"
check "caps every workspace, not just the first" \
  "[[ \$(ls -1 $X/workspaces/other-bbbb/logs | wc -l) -eq 5 ]]"
check "removes stale DerivedData" "[[ ! -d $D/RepVault-oldhash ]]"
check "keeps fresh DerivedData" "[[ -d $D/RepVault-newhash ]]"
rm -rf "$X" "$D"

# -------------------------------------------------------- under the cap is safe
X=$(make_workspaces 3); D=$(make_derived)
run "$X" "$D" --apply -y >/dev/null
check "a workspace under the cap is untouched" \
  "[[ \$(ls -1d $X/workspaces/repvault-aaaa/test-products/*.xctestproducts | wc -l) -eq 3 ]]"
rm -rf "$X" "$D"

# ------------------------------------------------------------- locked workspace
X=$(make_workspaces 8); D=$(make_derived)
print -- held > "$X/workspaces/repvault-aaaa/locks/build.lock"
out=$(run "$X" "$D" --apply -y)
check "skips a workspace with a held lock" \
  "[[ \$(ls -1d $X/workspaces/repvault-aaaa/test-products/*.xctestproducts | wc -l) -eq 8 ]]"
check "says why it skipped" "print -r -- ${(q)out} | grep -qi 'locked'"
check "still sweeps unlocked workspaces" \
  "[[ \$(ls -1d $X/workspaces/other-bbbb/test-products/*.xctestproducts | wc -l) -eq 5 ]]"
rm -rf "$X" "$D"

# --------------------------------------------------------------- path refusal
X=$(mktemp -d); D=$(make_derived)
mkdir -p "$X/workspaces"
out=$(RECLAIM_XCBMCP_ROOT="/" RECLAIM_DERIVED_ROOT="$D" RECLAIM_SKIP_PACKAGES=1 \
      bash "$RECLAIM" --apply -y 2>&1) && rc=0 || rc=$?
check "refuses a root that is not a cache directory" "[[ ${rc:-0} -ne 0 ]]"
check "explains the refusal" "print -r -- ${(q)out} | grep -qi 'refus'"
rm -rf "$X" "$D"

# ------------------------------------------------------------- missing roots
out=$(run /nonexistent/xcbmcp /nonexistent/derived) && rc=0 || rc=$?
check "a missing root is not an error" "[[ ${rc:-0} -eq 0 ]]"
rm -rf "$X" "$D" 2>/dev/null || true

print
print -P "%F{green}$PASS passed%f, %F{red}$FAIL failed%f"
(( FAIL == 0 ))
