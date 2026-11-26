#!/bin/bash
# Fixture check for cloud-gate.sh (the cloud session's usage gate) and its SessionStart hook line — run after
# ANY edit to either. A local bare repo stands in for GitHub: each case writes a usage.json onto its
# usage-meter branch, or hands the gate a file with --file. Never touches the network or the real branch.
#
# Usage: .claude/hooks/cloud-gate.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GATE="$SCRIPT_DIR/cloud-gate.sh"
SETTINGS="$SCRIPT_DIR/../settings.json"

t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@invalid \
  GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@invalid
fail=0
ok() { echo "ok:   $1"; }
bad() { echo "FAIL: $1"; fail=1; }

# meter JSON: publish JSON as usage.json on the bare repo's usage-meter branch (no JSON: a branch without it).
R=$t/gh.git
git init -q --bare "$R"
meter() {
  local tree
  if [ -n "$1" ]; then
    tree=$(printf '100644 blob %s\tusage.json\n' "$(printf '%s\n' "$1" | git -C "$R" hash-object -w --stdin)" | git -C "$R" mktree)
  else
    tree=$(git -C "$R" mktree </dev/null)
  fi
  git -C "$R" update-ref refs/heads/usage-meter "$(git -C "$R" commit-tree "$tree" -m meter)"
}
reading() { printf '{"as_of":%s,"verdict":"%s","week_pct":%s,"wind_down_pct":75}' $(($(date +%s) - $2)) "$1" "${3:-44}"; }

# Through git, as on the VM: a clone's origin carries the branch.
git init -q "$t/vm" && git -C "$t/vm" remote add origin "$R"
meter "$(reading go 60 46)"
out=$(cd "$t/vm" && "$GATE" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "go week=46%" <<<"$out" && ok "passes on a fresh go read through git" || bad "git go (rc $rc: $out)"
meter ""
out=$(cd "$t/vm" && "$GATE" 2>&1); rc=$?
[ $rc = 1 ] && grep -q "has no usage.json" <<<"$out" && ok "refuses a usage-meter branch with no usage.json" || bad "no usage.json (rc $rc: $out)"
# A real remote that lacks the branch, so the fetch fails on the refspec, not on a missing repo.
git init -q --bare "$t/none.git"
git init -q "$t/empty" && git -C "$t/empty" remote add origin "$t/none.git"
out=$(cd "$t/empty" && "$GATE" 2>&1); rc=$?
[ $rc = 1 ] && grep -q "no usage reading" <<<"$out" && ok "refuses when the branch is missing" || bad "missing branch (rc $rc: $out)"
# The fetch lands in the gate's own ref and leaves the checkout's FETCH_HEAD alone.
meter "$(reading go 60 46)"
rm -f "$t/vm/.git/FETCH_HEAD"
git -C "$t/vm" update-ref -d refs/cloud-gate/usage-meter 2>/dev/null
out=$(cd "$t/vm" && "$GATE" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "go week=46%" <<<"$out" && [ ! -e "$t/vm/.git/FETCH_HEAD" ] \
  && git -C "$t/vm" rev-parse -q --verify refs/cloud-gate/usage-meter >/dev/null \
  && ok "the fetch writes refs/cloud-gate/usage-meter, not FETCH_HEAD" || bad "fetch target (rc $rc: $out)"
# --session-start with no --file (the real VM call, an empty args array under set -u) passes a go.
out=$(cd "$t/vm" && CLAUDE_CODE_REMOTE=true "$GATE" --session-start 2>&1); rc=$?
[ $rc = 0 ] && grep -q "cloud-gate: go week=46%" <<<"$out" && ! grep -q "USAGE GATE STOP" <<<"$out" \
  && ok "--session-start through git passes a go" || bad "session-start through git (rc $rc: $out)"
# A fetch that stalls stops within CLOUD_GATE_FETCH_S instead of hanging past the hook's timeout.
mkdir -p "$t/slowbin" && realgit=$(command -v git)
printf '#!/bin/bash\nfor a; do [ "$a" = fetch ] && exec sleep 30; done\nexec %q "$@"\n' "$realgit" >"$t/slowbin/git" && chmod +x "$t/slowbin/git"
s0=$(date +%s)
out=$(cd "$t/vm" && PATH="$t/slowbin:$PATH" CLOUD_GATE_FETCH_S=1 "$GATE" 2>&1); rc=$?
el=$(($(date +%s) - s0))
[ $rc = 1 ] && grep -q "timed out after 1 s" <<<"$out" && [ $el -lt 10 ] \
  && ok "a stalled fetch stops in time (${el} s)" || bad "stalled fetch (rc $rc, ${el} s: $out)"

# Staleness tiers (default 30 min / 2 h).
j=$t/u.json
tier() { reading "$1" "$2" >"$j"; "$GATE" --file "$j" 2>&1; }
out=$(tier go 60); rc=$?; [ $rc = 0 ] && ok "fresh go passes" || bad "fresh go (rc $rc: $out)"
out=$(tier stop 60); rc=$?; [ $rc = 1 ] && grep -q "stop: week=44% gate 75%" <<<"$out" && ok "fresh stop fails" || bad "fresh stop (rc $rc: $out)"
out=$(tier go 3000); rc=$?; [ $rc = 0 ] && grep -q "meter stale since" <<<"$out" && ok "30 min-2 h go passes with a stale warning" || bad "stale go (rc $rc: $out)"
out=$(tier stop 3000); rc=$?; [ $rc = 1 ] && grep -q "its last verdict was stop" <<<"$out" && ok "30 min-2 h stop fails" || bad "stale stop (rc $rc: $out)"
out=$(tier go 8000); rc=$?; [ $rc = 1 ] && grep -q "past the 120 min limit" <<<"$out" && ok "over 2 h refuses even on go" || bad "over 2 h (rc $rc: $out)"
out=$(tier go -120); rc=$?; [ $rc = 0 ] && ok "a reading 2 min in the future (skew) passes" || bad "small skew (rc $rc: $out)"
out=$(tier go -86400); rc=$?; [ $rc = 1 ] && grep -q "in the future" <<<"$out" && ok "a reading a day in the future fails closed" || bad "future (rc $rc: $out)"
reading go 60 >"$j"; out=$("$GATE" --quiet --file "$j" 2>&1); rc=$?
[ $rc = 0 ] && [ -z "$out" ] && ok "--quiet prints nothing on go" || bad "--quiet (rc $rc: $out)"
now=$(date +%s)
for r in junk null '[]' '{"as_of":Infinity,"verdict":"go","week_pct":4}' '{"as_of":true,"verdict":"go","week_pct":4}' \
  "{\"as_of\":$now,\"verdict\":\"go\"}" "{\"as_of\":$now,\"verdict\":\"go\",\"week_pct\":null}" \
  "{\"as_of\":$now,\"verdict\":\"maybe\",\"week_pct\":4}" '{"as_of":0,"verdict":"go","week_pct":4}' \
  '{"as_of":0.5,"verdict":"go","week_pct":4}' "{\"as_of\":$now,\"verdict\":\"go\",\"week_pct\":4,\"wind_down_pct\":NaN}" \
  "{\"as_of\":$now,\"verdict\":\"go\",\"week_pct\":4,\"wind_down_pct\":Infinity}" \
  "{\"as_of\":$now,\"verdict\":\"go\",\"week_pct\":4,\"wind_down_pct\":-10}" \
  "{\"as_of\":$now,\"verdict\":\"go\",\"week_pct\":4,\"wind_down_pct\":101}"; do
  printf '%s\n' "$r" >"$j"; out=$("$GATE" --file "$j" 2>&1); rc=$?
  # Fails for being bad, not by falling through to the staleness check.
  [ $rc = 1 ] && grep -qE "stop: the usage reading is (unreadable|malformed)" <<<"$out" && ! grep -q Traceback <<<"$out" \
    && ok "reading '$r' fails closed as bad" || bad "reading '$r' (rc $rc: $out)"
done
"$GATE" --bogus >/dev/null 2>&1; [ $? = 2 ] && ok "'--bogus' exits 2" || bad "usage error"
"$GATE" --file "" >/dev/null 2>&1; [ $? = 2 ] && ok "--file '' exits 2" || bad "empty --file"
CLOUD_GATE_WARN_S=x "$GATE" --file "$j" >/dev/null 2>&1; [ $? = 2 ] && ok "a non-integer CLOUD_GATE_WARN_S exits 2" || bad "warn validation"
CLOUD_GATE_MAX_S=x "$GATE" --file "$j" >/dev/null 2>&1; [ $? = 2 ] && ok "a non-integer CLOUD_GATE_MAX_S exits 2" || bad "max validation"
CLOUD_GATE_WARN_S=9000 "$GATE" --file "$j" >/dev/null 2>&1; [ $? = 2 ] && ok "CLOUD_GATE_WARN_S above CLOUD_GATE_MAX_S exits 2" || bad "warn > max"
CLOUD_GATE_WARN_S= "$GATE" --file "$j" >/dev/null 2>&1; [ $? = 2 ] && ok "an empty CLOUD_GATE_WARN_S exits 2" || bad "empty warn"
for v in 0 00 41 '' x; do
  CLOUD_GATE_FETCH_S=$v "$GATE" --file "$j" >/dev/null 2>&1; rc=$?
  [ $rc = 2 ] && ok "CLOUD_GATE_FETCH_S='$v' exits 2" || bad "CLOUD_GATE_FETCH_S='$v' (rc $rc)"
done
# The vendored body still matches the checksum its header records (an edit here without the source is drift).
# The hash covers every line after the checksum line, and every line up to it must be a comment.
want=$(sed -n 's/^# body-sha256: \([0-9a-f]\{16\}\).*/\1/p' "$GATE")
got=$(sed '1,/^# body-sha256:/d' "$GATE" | sha256sum | cut -c1-16)
code_in_header=$(sed -n '1,/^# body-sha256:/p' "$GATE" | grep -cv '^#')
[ -n "$want" ] && [ "$want" = "$got" ] && [ "$code_in_header" = 0 ] && ok "the body matches its header checksum" \
  || bad "body checksum (header '$want', body '$got', non-comment header lines $code_in_header)"

# --session-start: silent off the VM, an instruction on stop on the VM, exit 0 either way.
reading stop 60 >"$j"
out=$(env -u CLAUDE_CODE_REMOTE "$GATE" --session-start --file "$j" 2>&1); rc=$?
[ $rc = 0 ] && [ -z "$out" ] && ok "--session-start is silent without CLAUDE_CODE_REMOTE" || bad "session-start local (rc $rc: $out)"
out=$(CLAUDE_CODE_REMOTE=true "$GATE" --session-start --file "$j" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "USAGE GATE STOP" <<<"$out" && ok "--session-start on the VM tells a stopped session not to start" || bad "session-start remote stop (rc $rc: $out)"
reading go 60 >"$j"
out=$(CLAUDE_CODE_REMOTE=true "$GATE" --session-start --file "$j" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "cloud-gate: go" <<<"$out" && ! grep -q "USAGE GATE STOP" <<<"$out" && ok "--session-start on the VM passes a go quietly" || bad "session-start remote go (rc $rc: $out)"
out=$(CLAUDE_CODE_REMOTE=true CLOUD_GATE_WARN_S=x "$GATE" --session-start --file "$j" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "USAGE GATE STOP" <<<"$out" && ok "--session-start exits 0 and stops the session on a bad setting" || bad "session-start bad env (rc $rc: $out)"
cp "$GATE" "$t/cg-noexec" && chmod 644 "$t/cg-noexec"
out=$(CLAUDE_CODE_REMOTE=true bash "$t/cg-noexec" --session-start --file "$j" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "cloud-gate: go" <<<"$out" && ! grep -q "USAGE GATE STOP" <<<"$out" \
  && ok "--session-start works from a copy without the exec bit (the hook runs bash FILE)" || bad "session-start noexec (rc $rc: $out)"

# The hook line itself, read from settings.json: no process and no output off the VM, exit 0 on the VM even
# when the script is missing (an older checkout), and a STOP on the VM with no reading.
hookcmd=$(python3 -I -c '
import json, sys
for group in json.load(open(sys.argv[1]))["hooks"]["SessionStart"]:
    for h in group["hooks"]:
        if "cloud-gate" in h["command"]:
            print(h["command"])
' "$SETTINGS")
[ -n "$hookcmd" ] && ok "settings.json has a SessionStart cloud-gate hook" || bad "no SessionStart cloud-gate hook in settings.json"
# Its timeout must outlast the gate's longest fetch (40 s plus the 5 s kill grace).
hookto=$(python3 -I -c '
import json, sys
for group in json.load(open(sys.argv[1]))["hooks"]["SessionStart"]:
    for h in group["hooks"]:
        if "cloud-gate" in h["command"]:
            print(h.get("timeout", ""))
' "$SETTINGS")
case "$hookto" in '' | *[!0-9]*) hookto=0 ;; esac
[ "$hookto" -gt 45 ] && ok "the hook's timeout ($hookto s) outlasts the longest fetch" || bad "hook timeout '$hookto' (need > 45)"
# Off the VM, against a project whose gate is a canary: the line's own CLAUDE_CODE_REMOTE check must stop it
# before any script starts (the gate's internal check would hide a missing one, so it isn't the real gate).
mkdir -p "$t/canary/.claude/hooks" && printf '#!/bin/bash\necho spawned\nexit 1\n' >"$t/canary/.claude/hooks/cloud-gate.sh"
out=$(cd / && env -u CLAUDE_CODE_REMOTE CLAUDE_PROJECT_DIR=$t/canary bash -c "$hookcmd" 2>&1); rc=$?
[ $rc = 0 ] && [ -z "$out" ] && ok "the hook line starts no script off the VM" || bad "hook line local (rc $rc: $out)"
out=$(cd / && CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR=$t/nowhere bash -c "$hookcmd" 2>&1); rc=$?
[ $rc = 0 ] && [ -z "$out" ] && ok "the hook line exits 0 on the VM when the project dir is missing" || bad "hook line bad cd (rc $rc: $out)"
mkdir -p "$t/nogate"
out=$(cd / && CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR=$t/nogate bash -c "$hookcmd" 2>&1); rc=$?
[ $rc = 0 ] && [ -z "$out" ] && ok "the hook line exits 0 silently on the VM when cloud-gate.sh is missing" || bad "hook line missing gate (rc $rc: $out)"
mkdir -p "$t/proj/.claude/hooks" && cp "$GATE" "$t/proj/.claude/hooks/" && git init -q "$t/proj" && git -C "$t/proj" remote add origin "$t/none.git"
out=$(cd / && CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR=$t/proj bash -c "$hookcmd" 2>&1); rc=$?
[ $rc = 0 ] && grep -q "no usage reading" <<<"$out" && grep -q "USAGE GATE STOP" <<<"$out" \
  && ok "the hook line stops a VM session with no reading (from any cwd)" || bad "hook line VM (rc $rc: $out)"

[ $fail = 0 ] && echo "cloud-gate.probe: all passed" || echo "cloud-gate.probe: FAILURES"
exit $fail
