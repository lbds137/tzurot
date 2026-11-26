#!/usr/bin/env bash
# cloud-gate: the cloud session's `claude-usage --ok`. A Claude Code cloud VM has no usage meter and can fetch only
# this repo, so the owner's machine publishes its plan usage reading to this repo's `usage-meter` branch (an orphan
# branch holding one usage.json; publisher: bin/usage-publish in lbds137/deck-platform, every 10 min) and this
# script judges that reading by age:
#   under 30 min old   pass or fail on the published verdict;
#   30 min to 2 h      warn "meter stale since HH:MM", fail only if the last verdict was stop;
#   over 2 h, missing  refuse (fail closed); so does a reading dated more than 5 min in the future.
# Age is measured from the reading's as_of (when the meter was read), not the commit time.
# VENDORED: the body below the header matches deck-platform's bin/cloud-gate; change it there first.
# body-sha256: 0bf9e89f0ac48f0f (first 16 hex of sha256 over every line after this one; the probe checks it)
set -u

usage() {
	cat <<'EOF'
usage: cloud-gate [--file PATH] [--quiet] [--session-start]
  Exit 0 go, 1 stop (over the gate, stale past 2 h, no reading or a malformed one), 2 usage error: the same exits
  as claude-usage --ok.
  --file PATH  judge this usage.json instead of fetching origin's usage-meter branch (tests, local checks).
  --quiet      no stdout on pass.
  --session-start  the repo SessionStart hook: does nothing unless CLAUDE_CODE_REMOTE=true, or when the hook input
               on stdin names a continuing session (source compact, resume or clear); otherwise it runs the gate and
               prints its line, plus on stop an instruction to start no work; always exits 0.
  CLOUD_GATE_WARN_S (default 1800) and CLOUD_GATE_MAX_S (default 7200) move the two age tiers; WARN may not
  exceed MAX. CLOUD_GATE_FETCH_S (default 20, 1 to 40) bounds the git fetch: a stalled fetch stops rather than hangs.
EOF
}

file=
quiet=0
hook=0
while [ $# -gt 0 ]; do
	case $1 in
	-h | --help) usage; exit 0 ;;
	--file) [ $# -ge 2 ] && [ -n "$2" ] || { usage >&2; exit 2; }; file=$2; shift ;;
	--quiet) quiet=1 ;;
	--session-start) hook=1 ;;
	*) echo "cloud-gate: unknown argument $1" >&2; usage >&2; exit 2 ;;
	esac
	shift
done

# Before any validation, so the hook exits 0 whatever goes wrong below.
if [ $hook -eq 1 ]; then
	[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
	# The gate refuses new units; a unit already running carries on past the wind-down line. So a session that
	# continues (compact, resume, clear, read from the hook input's `source`) is not judged: a STOP after a mid-unit
	# compaction would throw away paid-for work. Any other source, or none, is judged as a startup (fail closed).
	src=
	if [ ! -t 0 ]; then
		input=$(timeout 2 head -c 65536 2>/dev/null)
		src=$(python3 -I -c 'import json, sys
try:
    s = json.loads(sys.argv[1]).get("source")
except Exception:
    s = None
print(s if isinstance(s, str) else "")' "$input" 2>/dev/null)
	fi
	case $src in compact | resume | clear) exit 0 ;; esac
	args=()
	[ -n "$file" ] && args=(--file "$file")
	line=$(bash "$0" ${args[@]+"${args[@]}"} 2>&1 </dev/null)
	rc=$?
	printf '%s\n' "$line"
	if [ $rc -ne 0 ]; then
		printf '%s\n' "USAGE GATE STOP: the Claude plan usage gate refuses new work. Do not start the task or any other work." \
			"Tell the user the cloud usage gate refused, quoting the cloud-gate line above; in a dispatched unit, also write" \
			"that to /tmp/report.md and print it. Push nothing, and end."
	fi
	exit 0
fi

# `-`, not `:-`: a variable set to empty is a usage error, not the default.
warn=${CLOUD_GATE_WARN_S-1800}
max=${CLOUD_GATE_MAX_S-7200}
case "$warn" in '' | *[!0-9]*) echo "cloud-gate: CLOUD_GATE_WARN_S must be an integer" >&2; exit 2 ;; esac
case "$max" in '' | *[!0-9]*) echo "cloud-gate: CLOUD_GATE_MAX_S must be an integer" >&2; exit 2 ;; esac
[ "$warn" -le "$max" ] || { echo "cloud-gate: CLOUD_GATE_WARN_S ($warn) must not exceed CLOUD_GATE_MAX_S ($max)" >&2; exit 2; }
# 1 to 40 s: with the 5 s kill grace below the fetch is over by 45 s, inside the hook's 60 s timeout. `00` and
# other zero spellings are refused, since `timeout 0` means no timeout at all.
fetch_s=${CLOUD_GATE_FETCH_S-20}
case "$fetch_s" in [1-9] | [1-3][0-9] | 40) ;; *) echo "cloud-gate: CLOUD_GATE_FETCH_S must be 1 to 40 (seconds)" >&2; exit 2 ;; esac

if [ -n "$file" ]; then
	reading=$(cat -- "$file" 2>&1) || { echo "cloud-gate: stop: cannot read $file"; exit 1; }
else
	# Bounded, so a stalled fetch stops here instead of outliving the hook's timeout (that would start the session
	# with no STOP). Into a ref of its own, so the checkout's FETCH_HEAD is never touched.
	ref=refs/cloud-gate/usage-meter
	err=$(GIT_TERMINAL_PROMPT=0 timeout -k 5 "$fetch_s" git fetch -q --no-write-fetch-head origin "+refs/heads/usage-meter:$ref" 2>&1)
	frc=$?
	if [ $frc -ne 0 ]; then
		# 124: TERM on time; 137: KILL after the grace, for a fetch that ignored TERM.
		case $frc in 124 | 137) err="timed out after $fetch_s s" ;; esac
		echo "cloud-gate: stop: no usage reading (git fetch origin usage-meter failed: $(printf '%s' "$err" | sed -E 's#//[^@/]*@#//***@#g' | head -c 200))"
		exit 1
	fi
	reading=$(git show "$ref:usage.json" 2>/dev/null) || { echo "cloud-gate: stop: usage-meter has no usage.json"; exit 1; }
fi

python3 -I - "$reading" "$(date +%s)" "$warn" "$max" "$quiet" <<'PY'
import json, sys, time
raw, now, warn, mx, quiet = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] == "1"
SKEW = 300
def out(rc, msg):
    if rc or not quiet:
        print("cloud-gate: " + msg)
    sys.exit(rc)
def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)
try:
    r = json.loads(raw)
except ValueError:
    out(1, "stop: the usage reading is unreadable")
if not isinstance(r, dict):
    out(1, "stop: the usage reading is malformed")
as_of, verdict, week, wind = r.get("as_of"), r.get("verdict"), r.get("week_pct"), r.get("wind_down_pct")
if (verdict not in ("go", "stop") or not num(as_of) or not 1 <= as_of < 1e11
        or not num(week) or not 0 <= week <= 100
        or (wind is not None and (not num(wind) or not 0 <= wind <= 100))):
    out(1, "stop: the usage reading is malformed")
as_of = int(as_of)
age = now - as_of
since = time.strftime("%H:%M %Z", time.localtime(as_of))
fig = f"week={week}%" + (f" gate {wind}%" if wind is not None else "")
if age < -SKEW:
    out(1, f"stop: the usage reading is dated {-age // 60} min in the future ({since}); clock skew or a bad reading")
age = max(age, 0)
if age > mx:
    out(1, f"stop: meter stale since {since} ({age // 60} min, past the {mx // 60} min limit); {fig} not trusted")
if age > warn:
    if verdict == "stop":
        out(1, f"stop: meter stale since {since} ({age // 60} min) and its last verdict was stop ({fig})")
    print(f"cloud-gate: warning: meter stale since {since} ({age // 60} min); last verdict go ({fig})", file=sys.stderr)
    out(0, f"go (stale) {fig}")
if verdict == "stop":
    out(1, f"stop: {fig} (reading {age // 60} min old)")
out(0, f"go {fig} (reading {age // 60} min old)")
PY
