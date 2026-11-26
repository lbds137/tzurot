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
set -u

usage() {
	cat <<'EOF'
usage: cloud-gate [--file PATH] [--quiet] [--session-start]
  Exit 0 go, 1 stop (over the gate, stale past 2 h, no reading or a malformed one), 2 usage error: the same exits
  as claude-usage --ok.
  --file PATH  judge this usage.json instead of fetching origin's usage-meter branch (tests, local checks).
  --quiet      no stdout on pass.
  --session-start  the repo SessionStart hook: does nothing unless CLAUDE_CODE_REMOTE=true; on a cloud VM it runs
               the gate and prints its line, plus on stop an instruction to start no work; always exits 0.
  CLOUD_GATE_WARN_S (default 1800) and CLOUD_GATE_MAX_S (default 7200) move the two age tiers.
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
	args=()
	[ -n "$file" ] && args=(--file "$file")
	line=$("$0" "${args[@]}" 2>&1)
	rc=$?
	printf '%s\n' "$line"
	if [ $rc -ne 0 ]; then
		printf '%s\n' "USAGE GATE STOP: the Claude plan usage gate refuses new work. Do not start the task. Write /tmp/report.md" \
			"saying the cloud usage gate stopped this unit and quoting the cloud-gate line above, print it, push nothing, and end."
	fi
	exit 0
fi

warn=${CLOUD_GATE_WARN_S:-1800}
max=${CLOUD_GATE_MAX_S:-7200}
case "$warn" in '' | *[!0-9]*) echo "cloud-gate: CLOUD_GATE_WARN_S must be an integer" >&2; exit 2 ;; esac
case "$max" in '' | *[!0-9]*) echo "cloud-gate: CLOUD_GATE_MAX_S must be an integer" >&2; exit 2 ;; esac

if [ -n "$file" ]; then
	reading=$(cat -- "$file" 2>&1) || { echo "cloud-gate: stop: cannot read $file"; exit 1; }
else
	err=$(GIT_TERMINAL_PROMPT=0 git fetch -q origin refs/heads/usage-meter 2>&1) || {
		echo "cloud-gate: stop: no usage reading (git fetch origin usage-meter failed: $(printf '%s' "$err" | sed -E 's#//[^@/]*@#//***@#g' | head -c 200))"
		exit 1
	}
	reading=$(git show FETCH_HEAD:usage.json 2>/dev/null) || { echo "cloud-gate: stop: usage-meter has no usage.json"; exit 1; }
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
if (verdict not in ("go", "stop") or not num(as_of) or as_of != as_of or not 0 < as_of < 1e11
        or not num(week) or not 0 <= week <= 100 or (wind is not None and not num(wind))):
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
