#!/bin/bash
# Fixture check for grep-escaped-dollar-guard.sh — run after ANY edit to the
# hook. This hook reads no repo state — it decides purely from the command
# text — so the harness needs no fixture repo, only the JSON payload shape the
# PreToolUse hook receives on stdin.
#
# Every command string below is built with single quotes or a quoted heredoc,
# never a double-quoted bash string: a case whose backslash the PROBE's own
# shell ate would be testing a different string than the one named.
#
# Usage: .claude/hooks/grep-escaped-dollar-guard.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/grep-escaped-dollar-guard.sh"

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

# --- case 1: the incident's own command shape → blocks ------------------------
CMD1='grep -rn "\$extends" services/api-gateway/src'
run 2 "1: double-quoted backslash-dollar-identifier blocks" "Bash" "$CMD1"

# --- case 2: the correct single-quoted form → passes --------------------------
CMD2=$(cat <<'CMDEOF'
grep -rn '\$extends' services/api-gateway/src
CMDEOF
)
run 0 "2: single-quoted pattern passes" "Bash" "$CMD2"

# --- case 3: combined short flag carrying -F → passes -------------------------
run 0 "3: -rnF fixed-strings passes" "Bash" 'grep -rnF "\$extends" src'

# --- case 4: --fixed-strings long flag → passes -------------------------------
run 0 "4: --fixed-strings passes" "Bash" 'grep -rn --fixed-strings "\$extends" src'

# --- case 5: plain trailing anchor, no backslash → passes ---------------------
run 0 "5: plain trailing anchor passes" "Bash" 'grep -n "foo$" qf.txt'

# --- case 6: backslash-dollar with no identifier after it → passes ------------
run 0 "6: backslash-dollar with no identifier passes" "Bash" 'grep -n "foo\$" qf.txt'

# --- case 7: the CORRECT three-backslash form → passes ------------------------
# The shell reduces `"\\\$extends"` to `\$extends`, which grep reads as a
# literal dollar; the lookbehind in check (c) is what keeps this silent.
run 0 "7: three-backslash form passes" "Bash" 'grep -P "\\\$extends" src'

# --- case 8: rg → blocks ------------------------------------------------------
run 2 "8: rg blocks" "Bash" 'rg -n "\$extends" .'

# --- case 9: git grep → blocks ------------------------------------------------
run 2 "9: git grep blocks" "Bash" 'git grep -n "\$extends"'

# --- case 10: grep in a later pipeline segment → blocks -----------------------
run 2 "10: grep in a later pipeline segment blocks" "Bash" 'cat f | grep "\$extends"'

# --- case 11: not a grep invocation → passes ----------------------------------
run 0 "11: echo is not a grep invocation" "Bash" 'echo "\$extends"'

# --- case 12: bare "\$ident" with no backslash → passes (out of scope) --------
run 0 "12: bare variable pattern is out of scope" "Bash" 'grep "$extends" f'

# --- case 13: tool_name = Edit → passes (not Bash) ----------------------------
run 0 "13: tool_name=Edit passes" "Edit" "$CMD1"

# --- case 14: bypass env var → passes despite the failing shape ---------------
run 0 "14: TZUROT_ALLOW_GREP_DOLLAR=1 bypasses" "Bash" \
  'TZUROT_ALLOW_GREP_DOLLAR=1 grep -rn "\$extends" src'

# --- case 15: backslash-dollar in a NON-grep segment → passes -----------------
run 0 "15: backslash-dollar in a non-grep segment passes" "Bash" \
  'grep -F "x" f && echo "\$y"'

# --- case 16: single-quoted pattern after a double-quoted flag value → passes -
# The closing quote of `--include="*.ts"` must not be read as an opening one.
CMD16=$(cat <<'CMDEOF'
grep --include="*.ts" '\$extends' .
CMDEOF
)
run 0 "16: single-quoted pattern after a quoted flag value passes" "Bash" "$CMD16"

# --- case 17: leading underscore identifier → blocks --------------------------
run 2 "17: backslash-dollar-underscore blocks" "Bash" 'grep -rn "\$_private" src'

# --- case 18: failing pattern AFTER a double-quoted flag value → blocks -------
# The quoted-run walk has to consume `"*.ts"` whole to reach the real pattern.
run 2 "18: blocks past a double-quoted flag value" "Bash" \
  'grep -rn --include="*.ts" "\$extends" services/'

# --- case 19: failing pattern in a SECOND -e, past a quoted first one → blocks
# Heredoc-quoted because the command carries a single quote of its own.
CMD19=$(cat <<'CMDEOF'
grep -e "it's" -e "\$x" f
CMDEOF
)
run 2 "19: blocks past an earlier double-quoted -e pattern" "Bash" "$CMD19"

# --- case 20: flag-shaped text INSIDE the quoted pattern → blocks -------------
# ` -F ` here is part of the pattern, not a flag. The fixed-strings scan walks
# quoted runs so it cannot see it; an unscoped scan reads it as `-F` and skips
# the segment before the eaten check runs.
run 2 "20: -F inside the quoted pattern is not a flag" "Bash" \
  'grep -rn "prefix -F dollar \$extends" src/'

# --- case 21: a real --fixed-strings AFTER the pattern → passes ---------------
# The quoted-run walk consumes the pattern whole, so a flag on the far side of
# it is still reached.
run 0 "21: --fixed-strings after the pattern still counts" "Bash" \
  'grep -rn "\$extends" --fixed-strings src'

# --- case 22: git with a short global option before `grep` → blocks -----------
run 2 "22: git -C <dir> grep blocks" "Bash" 'git -C services grep -n "\$extends"'

# --- case 23: git with a long global option before `grep` → blocks ------------
run 2 "23: git --no-pager grep blocks" "Bash" 'git --no-pager grep "\$extends"'

# --- case 24: a git subcommand whose ARGUMENT mentions grep → passes ----------
# Only option-shaped tokens may sit between `git` and `grep`; this pins that
# restriction as load-bearing rather than incidental.
run 0 "24: git commit with grep in its message is not a grep" "Bash" \
  'git commit -m "grep \$x"'

# --- case 25: the brace form `"\${slug}"` → blocks ----------------------------
# After the shell eats the backslash, `${slug}` anchors at the `$` exactly like
# the bare identifier form. Goes red if the identifier class drops the `{`.
run 2 "25: brace-form backslash-dollar blocks" "Bash" 'grep -rn "\${slug}" src'

# --- case 26: the failing form inside a heredoc BODY → passes -----------------
# Newlines are segment separators, so without the heredoc-body strip each body
# line becomes its own segment and this non-grep command false-blocks. The
# inner heredoc is written through a quoted outer heredoc so it reaches the
# hook intact.
CMD26=$(cat <<'CMDEOF'
cat <<'EOF' > notes.md
the bad form is grep -rn "\$extends" src
grep -rn "\$extends" src
EOF
CMDEOF
)
run 0 "26: failing form inside a heredoc body passes" "Bash" "$CMD26"

# --- case 27: a REAL failing grep after an unrelated heredoc → blocks ---------
# The strip removes only the BODY; the command after the terminator is still a
# segment of its own. This is the other half of case 26 — without it, a strip
# that swallowed too much would pass unnoticed.
CMD27=$(cat <<'CMDEOF'
cat <<'EOF' > notes.md
hello
EOF
grep -rn "\$extends" src
CMDEOF
)
run 2 "27: real grep after an unrelated heredoc still blocks" "Bash" "$CMD27"

# --- case 28: a grep after a bare `&` → blocks --------------------------------
# Without the single `&` in the split set the whole line is one segment whose
# first word is `long_task`, and check (a) never reaches the grep.
run 2 "28: grep after a bare ampersand blocks" "Bash" \
  'long_task & grep -rn "\$extends" src'

# --- case 29: a grep opening a subshell → blocks ------------------------------
run 2 "29: grep inside a subshell blocks" "Bash" '(grep -rn "\$extends" src)'

# --- case 30: a grep opening a brace group → blocks ---------------------------
run 2 "30: grep inside a brace group blocks" "Bash" '{ grep -rn "\$extends" src; }'

# --- case 31: a redirection whose `&` splits the segment → still blocks -------
# The split at `2>&1` is harmless: the grep-bearing segment keeps its whole
# pattern, and the `1` fragment starts with no grep word.
run 2 "31: redirection ampersand does not lose the pattern" "Bash" \
  'grep -rn "\$extends" src 2>&1'

# --- case 32: a backgrounded NON-grep beside the failing shape → passes -------
# The negative half of case 28 — the `&` split only exposes a grep that is
# actually there, and neither half here is one.
run 0 "32: ampersand split does not invent a grep" "Bash" \
  'sleep 1 & echo "\$extends"'

exit $FAILURES
