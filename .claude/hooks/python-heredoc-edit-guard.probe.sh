#!/bin/bash
# Fixture check for python-heredoc-edit-guard.sh — run after ANY edit to the
# hook. This hook reads no repo state — it decides purely from the command
# text — so the harness needs no fixture repo, only the JSON payload shape
# the PreToolUse hook receives on stdin.
#
# Usage: .claude/hooks/python-heredoc-edit-guard.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/python-heredoc-edit-guard.sh"

FAILURES=0

# run <expected-exit> <label> <tool_name> <command>
run() {
  local expected="$1" label="$2" tool="$3" cmd="$4"
  jq -n --arg t "$tool" --arg c "$cmd" '{tool_name:$t,tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- case 1: python heredoc that writes a file → blocks ----------------------
CMD1=$(cat <<'CMDEOF'
python3 - <<'EOF'
p = "x.txt"
s = "hello"
open(p,'w').write(s)
EOF
CMDEOF
)
run 2 "python heredoc writing a file" "Bash" "$CMD1"

# --- case 2: python heredoc, read-only → passes -------------------------------
CMD2=$(cat <<'CMDEOF'
python3 - <<'EOF'
p = "x.txt"
print(open(p).read())
EOF
CMDEOF
)
run 0 "python heredoc read-only" "Bash" "$CMD2"

# --- case 3: node -e writing a file → blocks ----------------------------------
run 2 "node -e writeFileSync" "Bash" "node -e \"require('fs').writeFileSync('x','y')\""

# --- case 4: bypass env var → passes despite write shape ----------------------
CMD4=$(cat <<'CMDEOF'
TZUROT_ALLOW_HEREDOC_EDIT=1 python3 - <<'EOF'
open("x.txt",'w').write("hello")
EOF
CMDEOF
)
run 0 "TZUROT_ALLOW_HEREDOC_EDIT=1 bypasses" "Bash" "$CMD4"

# --- case 4b: quote-adjacent mention of the bypass literal does NOT bypass -----
# The anchor requires whitespace after `=1`, so a mention hugged by quotes or
# punctuation cannot bypass. (A prose mention with spaces on both sides still
# would — inherent to flat-string matching; the anchor narrows, not perfects.)
CMD4B=$(cat <<'CMDEOF'
python3 - <<'EOF'
open("x.txt",'w').write("prefix with 'TZUROT_ALLOW_HEREDOC_EDIT=1'.")
EOF
CMDEOF
)
run 2 "quote-adjacent bypass literal still blocks" "Bash" "$CMD4B"

# --- case 5: plain shell redirect → passes (not this hook's business) --------
run 0 "echo > file redirect passes" "Bash" "echo hi > /tmp/x"

# --- case 6: python -c, read-only → passes ------------------------------------
run 0 "python3 -c read-only" "Bash" "python3 -c \"print(open('a').read())\""

# --- case 7: tool_name = Edit → passes (not Bash) -----------------------------
run 0 "tool_name=Edit passes" "Edit" "python3 - <<'EOF'\nopen('x','w')\nEOF"

# --- case 8: Path(...).open('w') form → blocks ---------------------------------
CMD8=$(cat <<'CMDEOF'
python3 - <<'EOF'
from pathlib import Path
Path("x.txt").open('w').write("hello")
EOF
CMDEOF
)
run 2 "Path(...).open('w') blocks" "Bash" "$CMD8"

# --- case 9: keyword-arg open(path, mode='w') form → blocks --------------------
CMD9=$(cat <<'CMDEOF'
python3 - <<'EOF'
f = open("x.txt", mode='w')
f.write("hello")
EOF
CMDEOF
)
run 2 "open(path, mode='w') blocks" "Bash" "$CMD9"

exit $FAILURES
