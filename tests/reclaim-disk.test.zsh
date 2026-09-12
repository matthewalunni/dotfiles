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

# ---------------------------------------------------------------- simulators
# A fake simctl that serves canned JSON and logs every mutating call.
make_simctl() {
  local dir; dir="$(mktemp -d)"; dir="${dir:A}"
  local old=2026-01-01T00:00:00Z now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat > "$dir/devices.json" <<JSON
{"devices":{
 "rt.A":[{"udid":"STALE","name":"stale","state":"Shutdown","isAvailable":true,"lastBootedAt":"$old","dataPathSize":1048576},
         {"udid":"PINNED","name":"pinned","state":"Shutdown","isAvailable":true,"lastBootedAt":"$old"},
         {"udid":"BOOTED","name":"booted","state":"Booted","isAvailable":true,"lastBootedAt":"$old"},
         {"udid":"FRESH","name":"fresh","state":"Shutdown","isAvailable":true,"lastBootedAt":"$now"}],
 "rt.B":[{"udid":"NEVER","name":"never","state":"Shutdown","isAvailable":true}],
 "rt.C":[{"udid":"BROKEN","name":"broken","state":"Shutdown","isAvailable":false,"lastBootedAt":"$now"}]}}
JSON
  cat > "$dir/runtimes.json" <<JSON
{"R-A":{"identifier":"R-A","runtimeIdentifier":"rt.A","version":"1","lastUsedAt":"$old","sizeBytes":1},
 "R-B":{"identifier":"R-B","runtimeIdentifier":"rt.B","version":"2","lastUsedAt":"$old","sizeBytes":1},
 "R-C":{"identifier":"R-C","runtimeIdentifier":"rt.C","version":"3","lastUsedAt":"$now","sizeBytes":1},
 "R-D":{"identifier":"R-D","runtimeIdentifier":"rt.D","version":"4","lastUsedAt":"$old","sizeBytes":1,"deletable":false}}
JSON
  cat > "$dir/simctl" <<'SH'
#!/bin/bash
d="$(dirname "$0")"
case "$*" in
  "list devices -j") cat "$d/devices.json" ;;
  "runtime list -j") cat "$d/runtimes.json" ;;
  *) echo "$*" >> "$d/calls" ;;
esac
SH
  chmod +x "$dir/simctl"
  print -- "$dir"
}

S=$(make_simctl); D=$(make_derived)
RECLAIM_SIMCTL="$S/simctl" RECLAIM_XCBMCP_ROOT=/nonexistent RECLAIM_DERIVED_ROOT="$D" RECLAIM_SKIP_PACKAGES=1 \
  bash "$RECLAIM" --simulators >/dev/null 2>&1
check "simulators report-only calls nothing" "[[ ! -e $S/calls ]]"
RECLAIM_SIMCTL="$S/simctl" RECLAIM_XCBMCP_ROOT=/nonexistent RECLAIM_DERIVED_ROOT="$D" RECLAIM_SKIP_PACKAGES=1 \
  bash "$RECLAIM" --simulators --keep-sim PINNED --apply -y >/dev/null 2>&1
calls=$(cat "$S/calls" 2>/dev/null)
check "deletes a stale device"         "print -r -- ${(q)calls} | grep -qx 'delete STALE'"
check "deletes a never-booted device"  "print -r -- ${(q)calls} | grep -qx 'delete NEVER'"
check "deletes an unavailable device"  "print -r -- ${(q)calls} | grep -qx 'delete BROKEN'"
check "keeps a --keep-sim device"      "! print -r -- ${(q)calls} | grep -q PINNED"
check "keeps a booted device"          "! print -r -- ${(q)calls} | grep -q BOOTED"
check "keeps a recently booted device" "! print -r -- ${(q)calls} | grep -q FRESH"
check "keeps a runtime devices still use"     "! print -r -- ${(q)calls} | grep -q R-A"
check "deletes a runtime left unused"         "print -r -- ${(q)calls} | grep -qx 'runtime delete R-B'"
check "keeps a runtime used recently"         "! print -r -- ${(q)calls} | grep -q R-C"
check "keeps a runtime marked undeletable"    "! print -r -- ${(q)calls} | grep -q R-D"
check "deletes devices before runtimes" \
  "[[ \$(print -r -- ${(q)calls} | tail -1) == 'runtime delete R-B' ]]"
check "without --simulators nothing is deleted" \
  "rm -f $S/calls; RECLAIM_SIMCTL=$S/simctl RECLAIM_XCBMCP_ROOT=/nonexistent RECLAIM_DERIVED_ROOT=$D RECLAIM_SKIP_PACKAGES=1 bash $RECLAIM --apply -y >/dev/null 2>&1; [[ ! -e $S/calls ]]"
rm -rf "$S" "$D"

# ------------------------------------------------------------ device support
DS=$(mktemp -d)/iOS\ DeviceSupport; D=$(make_derived)
mkdir -p "$DS/iPhone13,2 18.6 (22G86)" "$DS/iPhone13,2 26.1 (23B85)" "$DS/iPhone13,2 9.3 (13E233)" "$DS/iPad8,1 17.0 (21A1)"
RECLAIM_DEVSUPPORT_ROOT="$DS" RECLAIM_XCBMCP_ROOT=/nonexistent RECLAIM_DERIVED_ROOT="$D" RECLAIM_SKIP_PACKAGES=1 \
  bash "$RECLAIM" --device-support --apply -y >/dev/null 2>&1
check "keeps the newest OS per model (version order, not text)" "[[ -d '$DS/iPhone13,2 26.1 (23B85)' ]]"
check "drops older OS versions"      "[[ ! -d '$DS/iPhone13,2 18.6 (22G86)' && ! -d '$DS/iPhone13,2 9.3 (13E233)' ]]"
check "keeps a model's only entry"   "[[ -d '$DS/iPad8,1 17.0 (21A1)' ]]"
rm -rf "${DS:h}" "$D"

# ------------------------------------------------------------ --derived-age 0
X=$(make_workspaces 1); D=$(make_derived)
run "$X" "$D" --derived-age 0 --apply -y >/dev/null
check "--derived-age 0 clears fresh DerivedData too" "[[ ! -d $D/RepVault-newhash ]]"
rm -rf "$X" "$D"

# ------------------------------------------------------------- missing roots
out=$(run /nonexistent/xcbmcp /nonexistent/derived) && rc=0 || rc=$?
check "a missing root is not an error" "[[ ${rc:-0} -eq 0 ]]"
rm -rf "$X" "$D" 2>/dev/null || true

print
print -P "%F{green}$PASS passed%f, %F{red}$FAIL failed%f"
(( FAIL == 0 ))
