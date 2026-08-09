#!/bin/bash
# Fixture check for lossy-pipe-guard.sh — run after ANY edit to the
# hook. Asserts the exit-code table over the shapes that matter: a git
# commit/push whose output feeds a filter blocks (exit 2); the same command
# unpiped or feeding a pure pass-through passes; a filter on some OTHER
# pipeline passes; and the plumbing subcommands (`git commit-tree`,
# `git commit-graph`) are not commits and must never block.
#
# This hook reads no git state — it decides purely from the command text —
# so the harness needs no fixture repo, only the JSON payload shape the
# PreToolUse hook receives on stdin.
#
# Colocated with the hook (not packages/tooling) because it IS the hook's
# verification mechanism — a bash exit-code harness over a bash hook, run
# manually on hook edits, with no ops-CLI surface.
#
# Usage: .claude/hooks/lossy-pipe-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/lossy-pipe-guard.sh"

FAILURES=0

# run <expected-exit> <label> <command>
run() {
  local expected="$1" label="$2" cmd="$3"
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- blocking shapes: a filter downstream of a commit/push -----------------
run 2 "commit piped to tail"                  'git commit -m "x" | tail'
run 2 "commit piped to grep"                  'git commit -m "x" | grep -i error'
run 2 "push piped to tail"                    'git push | tail'
run 2 "push piped to head"                    'git push origin develop | head -5'
run 2 "git -C global-flag commit piped"       'git -C /some/path commit -m "x" | tail'
run 2 "filter behind a pass-through stage"    'git commit -m "x" | cat | tail'
run 2 "commit piped via |& shorthand"         'git commit -m "x" |& grep fatal'

# --- plumbing subcommands are NOT `git commit` ----------------------------
# `-` is a non-word character, so a bare `commit\b` matched these and blocked
# a tree-writing plumbing call that this guard has no business touching.
run 0 "plumbing: commit-tree piped to tail"   'git commit-tree abc1234 | tail'
run 0 "plumbing: commit-graph piped to tail"  'git commit-graph write | tail'
run 0 "plumbing: commit-tree behind -C flag"  'git -C /some/path commit-tree abc1234 | head -1'
# The lookahead sits outside the (commit|push) alternation, so it guards the
# push branch too — `push-all` was a false positive under the bare \b form.
run 0 "plumbing: push-all piped to tail"      'git push-all origin | tail'

# --- non-blocking shapes --------------------------------------------------
run 0 "unpiped commit"                        'git commit -m "x"'
run 0 "unpiped push"                          'git push origin develop'
run 0 "commit into a pure pass-through"       'git commit -m "x" | cat'
run 0 "filter on an unrelated pipeline"       'git status | grep ts && git commit -m "x"'
run 0 "non-git command with a filter"         'pnpm test | tail -20'
run 0 "git log piped to a filter"             'git log --oneline | head -5'
run 0 "commit message merely mentions a pipe" 'git commit -m "fix: stop piping git push | tail"'

# --- rule 2: gh READ commands × TRUNCATION only ---------------------------
# Both directions are pinned per target. Testing only the BLOCK side is how an
# allow-list silently becomes a block-list: the guard would still look correct
# while firing on the very query it is meant to leave alone.
#
# The incident this rule exists for: `gh pr checks 2000 | tail -30` cut a red
# `lint` row off the TOP of the list and a failing release PR read as green.
run 2 "gh pr checks piped to tail"            'gh pr checks 2000 | tail -30'
run 2 "gh pr checks piped to head"            'gh pr checks 2000 | head -20'
run 2 "gh pr view piped to tail"              'gh pr view 2000 | tail -40'
run 2 "gh run list piped to head"             'gh run list --limit 50 | head -10'
run 2 "ops gh:pr-comments piped to tail"      'pnpm ops gh:pr-comments 2013 | tail -50'
run 2 "ops gh:pr-reviews piped to head"       'pnpm ops gh:pr-reviews 2013 | head -30'
run 2 "sed -n windowing counts as truncation" "gh pr checks 2000 | sed -n '5,20p'"
run 2 "truncator behind a pass-through"       'gh pr checks 2000 | cat | tail -5'

# SELECTION stays allowed — this is the correct query for the same command,
# and a guard that fires on it gets routed around.
run 0 "gh pr checks piped to awk predicate"   'gh pr checks 2000 | awk -F"\t" "\$2 != \"pass\""'
run 0 "gh pr checks piped to grep"            'gh pr checks 2000 | grep -v pass'
run 0 "gh pr checks piped to grep -c"         'gh pr checks 2000 | grep -cv pass'
run 0 "ops gh:pr-comments piped to grep"      'pnpm ops gh:pr-comments 2013 | grep "^## claude"'
run 0 "gh pr checks unpiped"                  'gh pr checks 2000'

# `gh api` is scoped to comment/review fetches, and that arm is decided from
# the RAW command because the URL carrying the discriminator is quoted and is
# stripped before the structural scan.
run 2 "gh api comments piped to tail"         'gh api "repos/o/r/issues/1/comments" | tail -5'
run 0 "gh api runs piped to head is allowed"  'gh api "repos/o/r/actions/runs?head_sha=abc" --jq ".x" | head -3'

# A gh read on an unrelated pipeline segment must not block.
run 0 "truncator on a different segment"      'gh pr checks 2000 && ls -la | head -3'
# Non-gh commands keep their truncators.
run 0 "pnpm output piped to head"             'pnpm test | head -20'

# --- escaped quotes must not swallow the pipeline ------------------------
# A GATE BYPASS, measured before the fix: the quote-stripping passes pair raw
# `"` characters left to right with no notion of escaping, so a token like
# `grep "a\""` contributes an ODD count. The unpaired quote pairs with the next
# real quote later in the command and everything between — a real `|` and the
# lossy stage after it — collapses into one `S`, so the scan sees no lossy
# stage at all.
#
# The git case is the important one: it predates the gh rule entirely, and a
# commit message containing an escaped quote is an ordinary thing to write.
run 2 "odd escaped-quote count, gh rule"      'gh pr checks 2000 | grep "a\"" | tail "-5"'
run 2 "odd escaped-quote count, git rule"     'git commit -m "a\"" | tail "-5"'
# EVEN backslash run. `\\` is one LITERAL backslash and leaves the closing
# quote unescaped — so neutralizing backslash-quote by presence rather than by
# parity eats the message's real closing quote, the opening quote pairs with a
# quote later in the command, and a real pipe plus its lossy stage disappear
# into one token. This exact input exited 0 under the odd-backslash fix while
# the PRE-FIX hook blocked it: a regression, caught in review, not a gap.
run 2 "even backslash run, git rule"          'git commit -m "path\\" | grep -i "error"'
# All three carry a QUOTED argument on the trailing stage. That is load-bearing,
# not decoration: the mangled quote has to have a later quote to pair with
# before anything gets swallowed. Without one, these pass even under the broken
# version — measured by canary, after writing two cases that pinned nothing.
run 2 "even backslash run, push"              'git push origin "b\\" | grep -i "error"'
run 2 "even backslash run, gh rule"           'gh pr checks 2000 | grep "x\\" | tail "-5"'
# The single-quote MIRROR of the bug above, and the reason `\'` is NOT
# neutralized: bash gives backslash no meaning inside `'...'`, so `'a\'` is a
# complete string. Treating it as an escape orphaned the opener, which then
# paired with grep's quote and swallowed the pipe — measured at exit 0.
#
# (The case this replaces asserted a verdict for `-m 'it\''`, which is not
# valid bash at all: that opens a second quote which never closes. It only ever
# passed because the buggy neutralization made it look terminated.)
run 2 "backslash before a closing single quote" "git commit -m 'a\\' | grep 'x'"

# --- a target hidden inside a command substitution ------------------------
# The quote strip replaces a quoted argument WHOLE, so a `$(…)` nested inside
# one disappears while bash still runs it — the stage scan saw `echo S | tail`
# and matched no target. The pipe here is real and at the top level, so `tail`
# does truncate the commit output that `echo` prints.
run 2 "quoted substitution hides the commit from the pipe scan" 'echo "$(git commit -m x)" | tail -5'
run 2 "same via a backtick substitution"                        'echo "`git push origin b`" | head -3'
# RULE 2 gets the SAME span protection: a gh read captured via a substitution and
# piped to a truncator truncates the read exactly as the direct pipe would, so it
# must block too — the git-only version of this scan left it exposed.
run 2 "quoted substitution hides the gh read from the pipe scan" 'echo "$(gh pr checks 2000)" | tail -5'
# And the complement: heredoc bodies come off the span before it is scanned, so
# a commit MESSAGE that merely discusses the phrase is not a target. Without the
# strip this blocks an ordinary `echo`.
run 0 "a heredoc BODY inside a span is not a target" 'echo "$(cat <<'"'"'EOF'"'"'
notes about git commit habits
EOF
)" | tail -5'
# And the non-heredoc complement: a quoted argument inside a span that merely
# mentions the target is inert prose, because the span is strip_quoted before
# scanning, exactly as the top-level pipe scan strips it. Capturing a gh command
# whose --body says "git push" then filtering the output must not block.
run 0 "quoted prose in a span is not a target" 'echo "$(gh pr comment 5 --body "remember to git push")" | tail -5'
# A BARE heredoc body mentioning $(git push), piped to a filter — inert data, so
# the helper strips it from the whole raw command before span extraction and the
# pipe does not block. Without the global strip the span scan would pull the
# $(git push) out of the heredoc and arm the git rule for the trailing filter.
run 0 "a bare heredoc body mentioning a push substitution is data" 'cat <<'"'"'EOF'"'"' | tail -5
notes: we closed the $(git push) bypass
EOF'
# BYPASS REGRESSION: an UNTERMINATED `<<WORD` in earlier quoted prose must not
# truncate a real gh/git target substitution + pipe that follows. The whole-
# command heredoc strip keeps the tail on an unterminated opener.
run 2 "unterminated heredoc opener does not truncate a later piped target" 'echo "notes: <<EOF"
echo "$(git push origin b)" | tail -5'
# THE ACCEPTED OVER-BLOCK, pinned as behaviour rather than left in a comment.
# The span scan is command-wide because the stage split runs on the STRIPPED
# text, where the span no longer exists to be tied back to its stage — so a
# target-bearing substitution in one segment arms the git rule for a filtered
# pipeline in another. Named here so the false positive is recognisable.
run 2 "the span scan is command-wide, not per-stage" 'echo "$(git commit -m x)" && ls | head -3'

# --- case and leading redirects ------------------------------------------
# Both were live bypasses. Case: the bash PRE-FILTER is checked first, so making
# only the python regexes case-insensitive would have fixed nothing — the
# command exits before the tokenizer runs. Redirect: `| 2>&1 tail` is valid bash
# and identical to redirecting before the pipe, but leaves the stage text
# starting with `2>&1`, which the anchored patterns miss.
run 2 "uppercase filter name"                 'git commit -m "x" | TAIL -5'
run 2 "uppercase target command"              'GIT COMMIT -m "x" | tail -5'
# Rule 2 needs the same pin. Case-insensitivity was itself a measured bypass
# fixed in this PR, and without a gh-side case a future edit that drops (?i)
# from GH_READ_TARGET — or narrows the pre-filter glob — regresses silently.
run 2 "uppercase gh target and filter"        'GH PR CHECKS 2000 | TAIL -30'
run 2 "leading redirect before the filter"    'git push origin b | 2>&1 tail -20'
run 2 "leading redirect, gh rule"             'gh pr checks 2000 | 2>&1 tail -5'
run 0 "unrelated command still unaffected"    'ls -la | tail'

# An escaped STRUCTURAL character is not syntax. `x\\|tail` is a literal
# argument, and bash runs no pipeline — re-emitting the bare `|` made the
# splitter invent a stage and false-block the commit.
run 0 "escaped pipe is a literal, not a stage" 'git commit -m x\|tail'
run 2 "a real pipe still blocks"               'git commit -m x | tail'

# --- escaped characters keep their value ---------------------------------
# Outside quotes bash lets a backslash escape any character, and the character
# keeps its own value. Collapsing every escape to a placeholder hid command
# names from the scan: a commit piped into this spelling of tail exited 0 while
# bash ran it as tail exactly as written.
run 2 "escaped filter name still detected"    'git commit -m "x" | t\ail -5'
run 2 "same on the gh rule"                   'gh pr checks 2000 | t\ail -5'

# --- ordinary apostrophes must not swallow the pipeline -------------------
# The two-pass quote strip paired the apostrophe in one double-quoted argument
# with the apostrophe in a later one, erasing the closing quote, the real pipe
# and the filter between them. Measured at exit 0 — rule 1's exact protected
# shape, allowed because someone wrote a contraction. The mirror (a literal
# double quote inside single-quoted arguments) failed the same way with the
# pass order swapped, which is why the fix is a stateful scan rather than a
# reordering.
run 2 "apostrophes in two double-quoted args" 'git commit -m "it'"'"'s" | grep "isn'"'"'t"'
run 2 "same shape on the gh rule"             'gh pr checks 2000 | grep "it'"'"'s" | tail "isn'"'"'t"'
run 2 "mirror: quotes inside single-quoted"   "git commit -m 'say \"hi\"' | grep 'say \"bye\"'"

# --- pathological flag runs must not hang the session ---------------------
# The flag-tolerance construct backtracked exponentially when the overall match
# FAILED: 26 dummy flags took 231ms, doubling every two, so ~34 would hang for
# minutes. PreToolUse on every Bash call makes that a session hang, not a slow
# command. Pinned with a wall-clock bound rather than a verdict, because the
# verdict was always correct — it just took forever to reach.
# DOUBLE dash, and each flag carries a value. Both details are load-bearing and
# neither was here before: `-x0 -x1 …` gives `-{1,2}` exactly one parse, so the
# re-partitioning that actually blows this pattern up is never reached, and the
# case passed in ~2ms while the real shape ran for minutes. A timing case that
# cannot reach the ambiguity measures nothing.
long_flags=$(python3 -c "print(' '.join(f'--flag{i} val{i}' for i in range(60)))")
# GIT_TARGET and GH_READ_TARGET are separately compiled, so each needs its OWN
# timed window. The git-side call originally sat outside the gh timer: its label
# promised a 2s bound it never asserted, and an independent regression there
# would have hung the probe instead of printing the FAIL this case exists for.
# The invocation runs UNDER `timeout`, and that is the whole point rather than
# belt-and-braces: a wall clock read AFTER the call cannot catch a hang, it can
# only report one that already finished. Catastrophic backtracking does not
# finish — measured, ~34 flags runs for minutes — so a post-hoc measurement
# would leave the probe wedged with no diagnostic, which is exactly the failure
# this case exists to report. `timeout` converts the hang into exit 124.
#
# GIT_TARGET and GH_READ_TARGET compile separately, so each gets its own call.
bounded_run() { # <label> <command>
  local label="$1" cmd="$2" start elapsed_ms rc
  start=$(date +%s%N)
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | timeout 5 "$HOOK" >/dev/null 2>&1
  rc=$?
  elapsed_ms=$(( ($(date +%s%N) - start) / 1000000 ))
  if [ "$rc" -eq 124 ]; then
    printf 'FAIL  (timed out at 5s)  %s is backtracking\n' "$label"
    FAILURES=$((FAILURES + 1))
  elif [ "$rc" -ne 0 ]; then
    printf 'FAIL  (exit %d, expected 0)  %s\n' "$rc" "$label"
    FAILURES=$((FAILURES + 1))
  elif [ "$elapsed_ms" -ge 2000 ]; then
    printf 'FAIL  (%dms, expected <2000ms)  %s is backtracking\n' "$elapsed_ms" "$label"
    FAILURES=$((FAILURES + 1))
  else
    printf 'PASS  (%dms)  %s stays well inside the bound\n' "$elapsed_ms" "$label"
  fi
}

# Flags sit BETWEEN `gh` and its subcommand — the only place GH_FLAGS can
# consume them. The previous spelling was `gh pr $long_flags`, which fails the
# match immediately and timed a path the flag group never entered.
#
# The trailing `pr` is not decoration: without a pr/run/api token the BASH
# pre-filter exits before python and the case times a process that never
# compiled the regex. Caught by canary — the reverted pattern still "passed"
# this case in 12ms. `pr nomatch` clears the pre-filter and still fails the
# match at `(checks|view)`, which is what forces the full backtrack.
bounded_run "60 dummy flags, gh side"  "gh $long_flags pr nomatch | tail -5"
bounded_run "60 dummy flags, git side" "git $long_flags nocommit | tail -5"

# Every `pnpm ops gh:*` wrapper is a read command. Enumerating just two of them
# left gh:pr-info and gh:ci-gate uncovered — the latter ends by printing the
# final check list, which is exactly the incident shape.
run 2 "ops gh:pr-info truncated"              'pnpm ops gh:pr-info 2013 | tail -5'
run 2 "ops gh:ci-gate truncated"              'pnpm ops gh:ci-gate 2013 | head -3'
run 0 "ops gh wrapper with a predicate"       'pnpm ops gh:pr-info 2013 | grep state'
# A WRITE wrapper must not be swept in — its output is a confirmation line, not
# rows that can hide a failure. A `gh:[a-z-]+` glob caught it and produced pure
# friction during this PR's own authoring.
run 0 "ops write wrapper is out of scope"     'pnpm ops gh:pr-edit 2013 --title x | tail -3'

# --- gh global flags between the command and its subcommand --------------
# `--repo`/`-R` is gh's standard way to target another repo, and an
# adjacency-only match missed every one of these. Note the trap this exposed:
# the bash PRE-FILTER also required adjacency, so tightening only the python
# regex left the bypass fully open — a pre-filter is a second gate.
run 2 "gh --repo before pr checks, truncated"  'gh --repo owner/name pr checks 2000 | tail -5'
run 2 "gh -R shorthand, truncated"             'gh -R owner/name pr checks 2000 | head -5'
run 2 "gh --repo before run list, truncated"   'gh --repo owner/name run list | head -3'
run 0 "gh --repo with a predicate is allowed"  'gh --repo owner/name pr checks 2000 | grep -v pass'

# --- the grep FAMILY, not just the literal word --------------------------
# Rule 1 blocks any filter on commit/push output. `egrep`/`fgrep`/`zgrep` are
# the same tool under another name and were slipping through, which is a bypass
# of the ORIGINAL rule — older than the gh rule and reachable by habit.
run 2 "push piped to egrep"                   'git push origin b | egrep fatal'
run 2 "commit piped to fgrep"                 'git commit -m x | fgrep error'
run 2 "push piped to zgrep"                   'git push origin b | zgrep warn'

# --- heredoc commit + a GENUINE trailing truncator ------------------------
# The decoy cases above pin that a truncator NAMED INSIDE the message is
# ignored. This pins the other half: a real truncator after the closing quote
# must still block, in both heredoc spellings. It survives because the
# double-quote strip spans newlines and collapses the whole $(cat …) — not
# because the MSG regex matched, which is why the indented form works too.
run 2 "heredoc message + real trailing tail"  'git commit -m "$(cat <<'"'"'EOF'"'"'
feat: x
EOF
)" | tail -5'
run 2 "INDENTED heredoc + real trailing tail" 'git commit -m "$(cat <<-'"'"'EOF'"'"'
	feat: x
	EOF
)" | tail -5'

# The indented heredoc must be stripped BY DESIGN, not by accident. The quoted
# forms above survive either way, because the double-quote strip spans newlines
# and collapses the whole $(...) span. Drop the surrounding quotes and that
# accident stops helping: without `<<-?` in the MSG regex this exits 0 — a
# BYPASS, measured, not a false block.
run 2 "UNQUOTED indented heredoc + trailing tail" 'git commit -m $(cat <<-EOF
	feat: x
	EOF
) | tail -5'

# --- sed truncation in its real spellings --------------------------------
# `\b` cannot fire mid-token, so a standalone-first-flag regex matched none of
# these — while all three truncate exactly like the tidy `sed -n '5,20p'` form.
run 2 "sed combined -ne"                      "gh pr checks 2000 | sed -ne '5,20p'"
run 2 "sed combined -rn"                      "gh pr checks 2000 | sed -rn '5,20p'"
run 2 "sed with -n not first"                 "gh pr checks 2000 | sed --posix -n '5,20p'"
# sed is blocked OUTRIGHT on a gh read, substitution included. The narrower
# rule rested on "without -n, sed prints every line", which `sed "5q"` disproves
# — and the script is quoted, so by scan time the stage reads `sed S` and no
# content check is possible. Block-all is the only honest option left.
run 2 "sed bare q truncates without -n"       'gh pr checks 2000 | sed "5q"'
run 2 "sed Q also truncates"                  'gh pr checks 2000 | sed "5Q"'
run 2 "sed substitution blocked too (cost)"   "gh pr checks 2000 | sed -e 's/a/b/'"

# awk stays allowed even though `awk "NR<=5"` truncates identically — blocking
# it would block the query this rule's own message recommends, and a guard that
# fires on its own recommended query gets routed around. Named as a gap in the
# hook header rather than closed.
run 0 "awk NR truncation is a NAMED gap"      'gh pr checks 2000 | awk "NR<=5"'

# --- raw-payload pre-check boundary ---------------------------------------
# The hook exits before forking jq when the RAW stdin lacks a pipe, or lacks
# the git+commit / git+push token pair. These pin that the fast path never
# swallows a command the decoded checks would have caught, and that the slow
# path is still reached when it must be.
run 0 "pre-check: pipe but no git token"      'ls -la | tail'
run 0 "pre-check: git commit but no pipe"     'git commit --amend --no-edit'
run 2 "pre-check: tokens split across a &&"   'echo commit && git push | tail'

# --- malformed / non-Bash input fails OPEN --------------------------------
printf '{"tool_name":"Read","tool_input":{"file_path":"x"}}' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  non-Bash tool passes\n'
else
  printf 'FAIL  non-Bash tool should pass\n'
  FAILURES=$((FAILURES + 1))
fi

printf 'not json at all' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  malformed tool-input fails open\n'
else
  printf 'FAIL  malformed tool-input should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

printf '' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  empty stdin fails open\n'
else
  printf 'FAIL  empty stdin should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
