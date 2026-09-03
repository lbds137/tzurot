#!/bin/bash
# Fixture check for board-commit-branch-gate.sh — run after ANY edit to the
# hook. Builds a scratch repo per case so branch + staged-set state is real,
# then asserts the exit-code table: a board-only commit on a feature branch
# blocks (exit 2); the same commit on develop, a mixed commit on a feature
# branch, a release-branch board commit, and the env-var bypass all pass.
#
# Colocated with the hook per the repo's probe convention: a bash exit-code
# harness over a bash hook, run manually on hook edits and by
# `pnpm ops guard:hook-probes`.
#
# Usage: .claude/hooks/board-commit-branch-gate.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/board-commit-branch-gate.sh"

FAILURES=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# make_repo <branch> — fresh repo checked out on <branch>, cwd left inside it.
make_repo() {
  local branch="$1" dir
  dir=$(mktemp -d "$WORK/repo.XXXXXX")
  git -C "$dir" init -q -b develop
  git -C "$dir" -c user.email=probe@x -c user.name=probe commit -q --allow-empty -m init
  if [ "$branch" != "develop" ]; then
    git -C "$dir" checkout -q -b "$branch"
  fi
  echo "$dir"
}

# run <expected-exit> <label> <repo-dir> [env-bypass]
run() {
  local expected="$1" label="$2" dir="$3" bypass="${4:-}"
  local actual
  (
    cd "$dir" || exit 99
    [ -n "$bypass" ] && export TZUROT_ALLOW_BOARD_ON_FEATURE=1
    jq -n '{tool_name:"Bash",tool_input:{command:"git commit -m msg"}}' \
      | "$HOOK" >/dev/null 2>&1
  )
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# assert_cmd <expected-exit> <command> <label> — the canonical BLOCKING fixture
# (feature branch, board-only staged set) with a custom command string. Every
# bypass-detection case shares that fixture on purpose: an existing case already
# proves it exits 2, so each gate downstream of the bypass check is held
# constant and the command text is the only variable.
assert_cmd() {
  local expected="$1" cmd="$2" label="$3" dir actual
  dir=$(make_repo feat/x)
  mkdir -p "$dir/tracker/tasks"
  echo t > "$dir/tracker/tasks/task-1 - probe.md"
  git -C "$dir" add tracker/
  (
    cd "$dir" || exit 99
    jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
      | "$HOOK" >/dev/null 2>&1
  )
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- blocking shape: board-only staged set on a feature branch -------------
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
run 2 "tracker-only commit on feat/x blocks" "$DIR"

# CURRENT.md counts as board too
DIR=$(make_repo feat/x)
echo c > "$DIR/CURRENT.md"
git -C "$DIR" add CURRENT.md
run 2 "CURRENT.md-only commit on feat/x blocks" "$DIR"

# --- passing shapes --------------------------------------------------------
# same staged set on develop
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
run 0 "tracker-only commit on develop passes" "$DIR"

# mixed set (code + board) on a feature branch is ordinary feature work
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add tracker/ src/
run 0 "mixed code+tracker commit on feat/x passes" "$DIR"

# release-shaped branch: release-notes/doc edits belong there
DIR=$(make_repo chore/release-v9.9.9)
mkdir -p "$DIR/docs"
echo n > "$DIR/docs/notes.md"
git -C "$DIR" add docs/
run 0 "docs commit on chore/release-* passes" "$DIR"

# empty staged set (nothing to assess)
DIR=$(make_repo feat/x)
run 0 "empty staged set passes" "$DIR"

# env-var bypass
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
run 0 "bypass env var passes" "$DIR" bypass

# --- bypass detection ------------------------------------------------------
# All of these share one fixture via assert_cmd (the canonical blocking shape),
# so the command text is the only variable and each case is decided by the
# bypass check rather than by some gate downstream of it.

# THE DOCUMENTED FORM: an env-assignment prefix on the very command the hook
# inspects. A PreToolUse hook runs before that command, so the prefix never
# reaches the hook's own environment and has to be read out of the command text.
assert_cmd 0 'TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m msg' \
  'documented env-prefix bypass on the command line passes'

# Prefix position is still honoured after a separator and behind another
# assignment — both are real shell assignment syntax.
assert_cmd 0 'cd . && FOO=1 TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m msg' \
  'bypass after a separator and another assignment passes'

# MESSAGE PLACEMENTS. The token mid-message sits PRECEDED BY A SPACE on purpose:
# an anchor that accepted any whitespace boundary would match that spelling in
# the raw command, so only quote-stripping can reject it — flush against the
# opening quote the anchor alone would decide it and the raw-vs-FLAGS_VIEW
# choice would go untested. The unquoted single-token form is the one message
# shape strip_quoted cannot help with, since there is no quoted span to collapse.
assert_cmd 2 'git commit -m "wip: TZUROT_ALLOW_BOARD_ON_FEATURE=1 handling on the gate"' \
  'bypass token inside a commit message does not open a hole'
assert_cmd 2 'git commit -m TZUROT_ALLOW_BOARD_ON_FEATURE=1' \
  'unquoted single-token message is not a bypass'

# A bare mention with no `=` is not an assignment: one character away from the
# passing case above.
assert_cmd 2 'TZUROT_ALLOW_BOARD_ON_FEATURE git commit -m msg' \
  'bare token mention with no = is not a bypass'

# DISCONNECTED PLACEMENTS. The token IS at a segment start in each, so a
# prefix-position-only anchor accepts it — but in shell semantics it governs
# nothing: the commit already ran, and a trailing `VAR=val` with no command
# after it is inert. Appending one to a board-only commit is an ordinary idiom,
# squarely inside the hook's stated threat model. The last of these also covers
# grep anchoring `^` per LINE, which makes a lone token opening line 2 look like
# a segment start too.
for disconnected in \
  'git add tracker/ && git commit -m msg; TZUROT_ALLOW_BOARD_ON_FEATURE=1' \
  'git commit -m msg && TZUROT_ALLOW_BOARD_ON_FEATURE=1' \
  'TZUROT_ALLOW_BOARD_ON_FEATURE=1 echo unrelated && git commit -m msg' \
  "$(printf 'git commit -m msg\nTZUROT_ALLOW_BOARD_ON_FEATURE=1')"; do
  assert_cmd 2 "$disconnected" "disconnected bypass token does not authorize: ${disconnected%%$'\n'*}"
done

# OVER-AUTHORIZATION. A match anywhere would exit the hook for the WHOLE tool
# call, so one prefixed commit would waive the check for a bypass-free commit
# beside it — the only shape that would fail toward GRANTING rather than
# blocking. Both orderings, since the bypassed commit may come first or second.
assert_cmd 2 'git commit -m unrelated && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m doc' \
  'a bypass on one commit does not waive a bypass-free commit after it'
assert_cmd 2 'TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m doc && git commit -m unrelated' \
  'a bypass on one commit does not waive a bypass-free commit before it'

# ...but a compound where EVERY commit carries the prefix is a legitimate bypass.
assert_cmd 0 'TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m a && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m b' \
  'a compound where every commit carries the prefix passes'

# Three commits with the un-bypassed one in the MIDDLE. The count comparison
# should generalize past N=2 by construction, but this logic has now carried two
# separate bypass bugs, so the generalization gets pinned rather than inferred.
assert_cmd 2 'TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m a && git commit -m b && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m c' \
  'a bypass-free commit in the middle of a three-commit chain still blocks'
assert_cmd 0 'TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m a && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m b && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m c' \
  'three commits all carrying the prefix pass'

# The same all-carry-the-prefix compound joined by each of the OTHER separators.
# `;`, `&` and `|` all open a new command, so the count comparison should treat
# them exactly as it treats `&&` — and this is the arm where that actually gets
# decided: the bypass pattern's left context is what has to recognise the
# separator before the second commit can be counted as bypassed. Narrowing that
# left context by one separator reddens only the spelling it dropped and leaves
# the `&&` cases above green, which is how each of these three earns its place.
#
# NOT parameterized, deliberately: the BLOCKING arms above (a bypass-free commit
# before, after, or in the middle of the chain). Those reach `block` through the
# count comparison alone, which never inspects the separator — every mutation
# that reddens their `;`/`&`/`|` spellings reddens the `&&` spellings above in
# the same run, so they would report coverage they do not add. Same reasoning as
# the not-probed note further down: a case that cannot fail on its own measures
# nothing. The three-commit chain is likewise left at `&&` only — it pins the
# N>2 generalization once, and the separator handling is already decided by the
# two-commit form below.
for sep in ';' '&' '|'; do
  assert_cmd 0 "TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m a ${sep} TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m b" \
    "a compound joined by ${sep} where every commit carries the prefix passes"
done

# SEPARATOR-TERMINATED ASSIGNMENTS. `;`, `&` and `|` end a word with or without
# surrounding space, so each of these is an unexported assignment followed by a
# SEPARATE commit that never sees the variable. A value class excluding only
# whitespace would swallow the separator and read the whole thing as one
# prefixed invocation — a false GRANT, which is the direction this check must
# never fail in.
for sep in ';' '&' '|'; do
  assert_cmd 2 "TZUROT_ALLOW_BOARD_ON_FEATURE=1${sep} git commit -m msg" \
    "an assignment terminated by ${sep} does not carry into the commit"
done

# THE MISTAKEN COMPOUND-OPERATOR ATTEMPT: joining the assignment to the commit
# with `&&` instead of using it as a bare prefix. Shell-wise it is the same inert
# shape as the separator-terminated cases above — an unexported assignment, then
# a SEPARATE command that never sees the variable — so refusing it is correct,
# and the hook names it in KNOWN GAPS. It is a plausible spelling for someone
# reaching for the documented bypass, which is why the refusal is pinned here
# rather than left to the reader of that block.
#
# Two neighbouring spellings are NOT probed. `export VAR=1 && git commit` really
# would export the variable, so its refusal is a genuine gap the hook already
# documents — pinning it would freeze a behaviour we may want to change. And
# `VAR=1&&git commit` (no spaces) cannot be reddened: the value class stops at
# the `&` and the whitespace the pattern then requires is absent, so it fails to
# match under every mutation that changes only the separator handling.
assert_cmd 2 'TZUROT_ALLOW_BOARD_ON_FEATURE=1 && git commit -m msg' \
  'an assignment joined to the commit by && is not a bypass'

# QUOTE-STRIPPING FAILURE must not disarm the gate. strip_quoted returns None on
# an unterminated quote, and printing that emitted the literal "None" as
# FLAGS_VIEW — matching no commit, so the pre-filter exited and the whole hook
# went inert. Both shapes below land on that path: a bare unterminated quote,
# and ANSI-C quoting whose escaped \' the scanner reads as a terminator.
assert_cmd 2 'git commit -m "oops' \
  'an unterminated quote does not disarm the gate'
assert_cmd 2 "git commit -m \$'foo\\'s a word'" \
  'ANSI-C quoting with an escaped quote does not disarm the gate'

# ...and when the scan fails, the bypass must fail CLOSED. The fallback hands
# the RAW command to detection, which is right for detection but would let a
# commit MESSAGE spoof the bypass token — the one guarantee the whole
# FLAGS_VIEW design rests on. Detection arms on raw text; the bypass does not
# run at all. Both halves fail toward the harmless outcome for what they govern.
# NOT probed, deliberately: spoofing the bypass from inside a message during a
# scan failure. It has no failing fixture. The spoof needs the token in prefix
# position in the RAW text, which requires a separator inside the message, and
# the message itself must then contain a `git ... commit` for the pattern to
# reach — giving two commit invocations against one bypassed, so the
# all-commits-carry-it count blocks it before the scan-status guard is consulted.
# The guard in the hook is belt-and-braces for the day that count rule changes;
# a probe asserting it here would pass with the guard removed and measure nothing.

# An EMPTY value is not a bypass, matching the process-env path, which requires
# a non-empty value. The two paths are documented as equivalent; without the
# non-empty requirement in the pattern they would disagree on this one spelling.
assert_cmd 2 'TZUROT_ALLOW_BOARD_ON_FEATURE= git commit -m msg' \
  'an empty assignment value is not a bypass'

# -a auto-stage: board-only MODIFIED tracked file, nothing staged, -a as the
# LAST token (the trailing-token shape) must still block
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m board
git -C "$DIR" checkout -q -b feat/x
echo t2 > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit -m msg -a"}}'     | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  trailing -a with board-only modified set blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  trailing -a with board-only modified set blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# -a with a MIXED modified set passes
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add tracker/ src/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m base
git -C "$DIR" checkout -q -b feat/x
echo t2 > "$DIR/tracker/tasks/task-1 - probe.md"
echo x2 > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit -am msg"}}'     | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  -am with mixed modified set passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  -am with mixed modified set passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# COMPOUND SHAPE: `git add <board> && git commit` in ONE command, nothing
# staged yet — the PreToolUse hook must see the add's pathspec, not the empty
# staged set. This is the most common real invocation.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  compound add+commit of board files blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  compound add+commit of board files blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# compound add+commit of MIXED paths passes
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ src/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  compound add+commit of mixed paths passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  compound add+commit of mixed paths passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# --allow-empty must NOT trigger the --all auto-stage branch: board-only
# STAGED set + a dirty non-board file that auto-stage would wrongly admit
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add src/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m code
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
echo x2 > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit --allow-empty -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  --allow-empty does not smuggle dirty files past the board check\n'
else
  printf 'FAIL  (exit %d, expected 2)  --allow-empty does not smuggle dirty files past the board check\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# an unrelated command that merely CONTAINS "git commit" (quoted) never
# blocks, even with board files staged on a feature branch
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"grep -r \"git commit\" docs/"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  quoted \"git commit\" inside another command passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  quoted \"git commit\" inside another command passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# MULTI-LINE HEREDOC MESSAGE (the repo's canonical commit shape): body prose
# containing "git add", "-a", "--all" must NOT feed the detectors. Code-only
# staged set on a feature branch + heredoc body mentioning git add -> passes.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/src"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add src/
(
  cd "$DIR" || exit 99
  CMD='git commit -m "$(cat <<'"'"'EOF'"'"'
docs: explain how git add tracker/ works with -a and --all flags
EOF
)"'
  jq -n --arg c "$CMD" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  heredoc body mentioning git add/-a/--all does not spoof detection\n'
else
  printf 'FAIL  (exit %d, expected 0)  heredoc body mentioning git add/-a/--all does not spoof detection\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# TWO git add invocations in one compound — BOTH pathspecs must count.
# Non-board first, board second: a mixed commit, must PASS (the greedy
# single-pass extraction saw only the board tail and blocked it).
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add src/a.ts && git add tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  two-add compound, non-board first, passes as mixed\n'
else
  printf 'FAIL  (exit %d, expected 0)  two-add compound, non-board first, passes as mixed\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# board first, non-board second: also mixed, also passes
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ && git add src/a.ts && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  two-add compound, board first, passes as mixed\n'
else
  printf 'FAIL  (exit %d, expected 0)  two-add compound, board first, passes as mixed\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# two-add compound, BOTH board — still blocks
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/backlog"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo b > "$DIR/backlog/now.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ && git add backlog/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  two-add compound, both board, blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  two-add compound, both board, blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# BARE directory pathspec (no trailing slash) — git treats `add tracker`
# identically to `add tracker/`, so it must still block
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  bare-directory add pathspec (no slash) blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  bare-directory add pathspec (no slash) blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# a PATHSPEC containing "commit-graph" must not disable the hook
DIR=$(make_repo feat/x)
mkdir -p "$DIR/docs" "$DIR/tracker/tasks"
echo n > "$DIR/docs/commit-graph-notes.md"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add docs/commit-graph-notes.md tracker/ && git commit -m notes"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  commit-graph in a pathspec does not disable the gate\n'
else
  printf 'FAIL  (exit %d, expected 2)  commit-graph in a pathspec does not disable the gate\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# real plumbing subcommand still passes
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit-tree HEAD^{tree} -m x"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  git commit-tree plumbing passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  git commit-tree plumbing passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# CONTRACTION-PAIRING class (the shared-scanner fix): an apostrophe in an
# earlier double-quoted arg + one in the commit message must NOT erase the
# `git commit` between them. Board-only staged on a feature branch -> blocks.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  CMD='echo "it'"'"'s" && git commit -m "won'"'"'t"'
  jq -n --arg c "$CMD" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  cross-quote contraction pairing does not erase the commit\n'
else
  printf 'FAIL  (exit %d, expected 2)  cross-quote contraction pairing does not erase the commit\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# ./-prefixed board pathspec still counts as board
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add ./tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  ./-prefixed board pathspec blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  ./-prefixed board pathspec blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# --- the shared-pattern behaviour changes ----------------------------------
# Detection is the pattern `develop-code-commit-guard.sh` and `lossy-pipe-guard.sh`
# carry, spelled identically and held to one case table by
# gitCommitPatternAgreement.test.ts. Adopting it is not behaviour-neutral: each
# case below is a shape this gate did NOT see before, and every one of them
# arms the gate rather than disarming it. They share the canonical blocking
# fixture so the command text is the only variable.

# A value-taking global flag between `git` and the subcommand. The pattern's
# `(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*` consumes the flag's VALUE; a flag class
# that only matched dash-leading words stopped at `user.name=x` and never
# reached `commit`.
assert_cmd 2 'git -c user.name=x commit -m msg' \
  'a value-taking global flag no longer defeats detection'

# Case. Shells accept `GIT COMMIT`, and the pattern's leading `(?i)` sees it.
# The raw short-circuit above the python block has to be case-insensitive too,
# which is what this case actually decides — a case-sensitive `case` statement
# exits before the pattern is ever consulted.
assert_cmd 2 'GIT COMMIT -m msg' \
  'uppercase GIT COMMIT still blocks'

# Right boundary. `(?![-\w])` consumes nothing, so a separator flush against
# `commit` is a match; requiring whitespace-or-end after it missed this.
assert_cmd 2 'git commit;git status' \
  'a commit flush against a chaining semicolon is detected'

# Left boundary. `\b` treats a preceding `-` as a boundary, where an explicit
# `[^[:alnum:]_-]` class excluded it. Over-arming: the branch and allowlist
# checks simply get to run on a command that may not be git at all.
assert_cmd 2 'my-git commit -m msg' \
  'a dash-prefixed wrapper name arms detection'

# Python's `\s` is Unicode-aware, so a non-breaking space between `git` and
# `commit` is a real match. Written as an ESCAPE: a raw U+00A0 is
# indistinguishable from a plain space on screen, and retyped as one this case
# would silently become a duplicate of the plain `git commit` case.
assert_cmd 2 "$(printf 'git\u00a0commit -m msg')" \
  'a non-breaking space between git and commit is detected'

# The same flag-value consumption on the `git add` half. Nothing is staged here,
# so the add pathspec is the ONLY source of the assessed file set — an add
# invocation missed because of its global flag left the set empty and passed.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git -C . add tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  a global flag on git add no longer hides its pathspec\n'
else
  printf 'FAIL  (exit %d, expected 2)  a global flag on git add no longer hides its pathspec\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# AUTO-STAGE SCOPING. `-a` belongs to the invocation it is written on. Scanned
# over the whole command, the `-a` on `git branch` read as an auto-staging
# commit, pulled in the dirty non-board file, and the mixed set turned a
# board-only commit into a silent PASS. Board file staged, unrelated non-board
# file dirty, `-a` on a NON-commit git invocation -> must still block.
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add src/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m code
git -C "$DIR" checkout -q -b feat/x
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
echo x2 > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git branch -a && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  -a on a non-commit git invocation does not auto-stage\n'
else
  printf 'FAIL  (exit %d, expected 2)  -a on a non-commit git invocation does not auto-stage\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# ...and the same fixture with `-a` on the COMMIT still auto-stages, so the case
# above pins the scoping rather than the auto-stage branch simply being dead.
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add src/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m code
git -C "$DIR" checkout -q -b feat/x
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
echo x2 > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git branch && git commit -a -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  -a on the commit itself still auto-stages the dirty set\n'
else
  printf 'FAIL  (exit %d, expected 0)  -a on the commit itself still auto-stages the dirty set\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# non-commit git command never blocks
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git status"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  non-commit command passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  non-commit command passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "board-commit-branch-gate probe: $FAILURES FAILURE(S)"
  exit 1
fi
echo "board-commit-branch-gate probe: all cases pass"
exit 0
