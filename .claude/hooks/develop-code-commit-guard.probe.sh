#!/bin/bash
# Fixture check for develop-code-commit-guard.sh — run after ANY edit to the
# hook. Asserts the exit-code table over the command shapes that have
# historically been missed: the first live-probe round only exercised
# single-line `-m "..."` commits and shipped a strip step that silently
# no-opped on the repo's canonical heredoc commit format.
#
# Colocated with the hook (not packages/tooling) because it IS the hook's
# verification mechanism — a bash exit-code harness over a bash hook, run
# manually on hook edits, with no ops-CLI surface.
#
# Usage: .claude/hooks/develop-code-commit-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/develop-code-commit-guard.sh"
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

TMP_BASE=$(mktemp -d)
# The header-check ack key is date-scoped (UTC day), not per-run: without a
# per-run ack file here, a second run of this probe on the same day would
# find every header block already acked from the first run and silently pass
# every header case. TMP_BASE is fresh per invocation and removed by the EXIT
# trap, so this file never survives across runs.
export DEVELOP_COMMIT_HEADER_ACK_FILE="$TMP_BASE/commit-header-ack"
WT="$TMP_BASE/probe-wt"
FEATURE_WT="$TMP_BASE/probe-feature-wt"
MAIN_WT="$TMP_BASE/probe-main-wt"
CREATED_BRANCHES=""
cleanup() {
  git -C "$REPO_ROOT" worktree remove "$WT" --force 2>/dev/null
  git -C "$REPO_ROOT" worktree remove "$FEATURE_WT" --force 2>/dev/null
  git -C "$REPO_ROOT" worktree remove "$MAIN_WT" --force 2>/dev/null
  git -C "$REPO_ROOT" branch -D probe/feature-fixture 2>/dev/null
  # A failed delete here is the one cleanup failure worth SAYING, because these
  # names are `develop`/`main`: if worktree removal above lost a race, the branch
  # is still checked out and this silently no-ops, leaving a stray one behind for
  # the rest of the job. Loud beats swallowed — everything else here is
  # best-effort by design.
  for b in $CREATED_BRANCHES; do
    git -C "$REPO_ROOT" branch -D "$b" 2>/dev/null ||
      echo "WARNING: could not delete fabricated branch '$b' — remove it by hand" >&2
  done
  rm -rf "$TMP_BASE"
}
# EXIT alone is enough for the timeout path, and that is measured rather than
# assumed: SIGTERM'ing a bash script while it is blocked in a foreground child
# DOES run its EXIT trap (probed — trap body observed, exit 143). So a probe
# killed at guard:hook-probes' 120s ceiling still removes its worktrees and any
# fabricated branches. SIGKILL remains the one path that skips this, which is
# the residual documented on add_named_worktree below.
trap cleanup EXIT

# Put a worktree on a branch with an EXACT name. The hook decides from
# `rev-parse --abbrev-ref HEAD`, so the branch's NAME is what matters, not its
# history — which is both what makes the fallback below sound and why a
# probe-scoped name like `probe/develop` would test nothing.
#
# --force: the primary checkout routinely sits ON develop (doc commits,
# post-release), and worktree add refuses a branch checked out elsewhere.
# Safe here — the probe never commits, it only reads branch + status.
#
# WHY THE GATE IS `GITHUB_ACTIONS` AND NOT `ACT` AND NOT `CI`. `CI` alone is far
# too broad — plenty of non-ephemeral environments export it (test runners, shell
# profiles), and there the fabrication would land in a REAL working repo, which
# is the outcome this gate exists to prevent.
#
# `GITHUB_ACTIONS` alone is not sufficient either, and this is the part worth
# reading: nektos/act sets ALL THREE of `GITHUB_ACTIONS=true`, `CI=true` and
# `ACT=true`. act exists to reproduce the runner environment, so it deliberately
# looks like one. A contributor running act against their real clone to debug
# the lint job is therefore precisely the scenario that would otherwise get
# branches fabricated in a live repo.
#
# Evidence, stated so it can be re-checked: act is NOT installed on this machine
# (`which act` — nothing), so a live capture was unavailable and this comes from
# act's own ASSIGNMENT SITES in pkg/runner/run_context.go — `withGithubEnv` sets
# GITHUB_ACTIONS and CI, `GetEnv` sets ACT. That is the producer, not a doc page
# that could have drifted from it. If act ever lands on a dev box here, a live
# `act -n` env dump would upgrade this from producer-read to runtime-confirmed;
# until then do not weaken the gate on the assumption that it might be wrong.
#
# `ACT` is act's own documented opt-out for exactly this, so requiring
# GITHUB_ACTIONS AND NOT ACT is the pair that means "a genuine ephemeral
# runner". Do not simplify either half away.
#
# WHY THE FALLBACK IS CI-ONLY. `actions/checkout` fetches only the PR ref, so
# on a runner neither `develop` nor `main` exists locally; the unconditional
# `worktree add … develop` this replaced died there with "invalid reference:
# develop" the first time guard:hook-probes ran the harness — the checkout-shape
# dependency the gate was written to expose. Fabricating the branch is fine
# there (ephemeral, never pushed) and a bad trade anywhere else: a fresh
# `git clone` has `main` and no local `develop`, so a contributor running
# `pnpm quality` would silently gain a `develop` pointing at main's HEAD, and
# their next `git checkout develop` would land on it instead of tracking
# origin/develop. Off CI the probe keeps its original LOUD failure — an
# actionable message beats a fabricated branch. (The exposure is `pnpm quality`,
# not `git push`: `.husky/pre-push` composes its own list and omits this guard.)
#
# Residual, accepted, CI-only: a stray survivor of a hard kill is ADOPTED rather
# than re-created — show-ref finds it, takes the real-branch path, and never
# records it in CREATED_BRANCHES, so it is never cleaned either. Harmless (only
# the name is read), and the cleanup that would fix it needs a heuristic telling
# "stray" from "real", which when wrong DELETES a real branch.
add_named_worktree() { # <path> <branch-name>
  local path="$1" name="$2"
  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$name"; then
    git -C "$REPO_ROOT" worktree add --force "$path" "$name" >/dev/null
  elif [ -n "${GITHUB_ACTIONS:-}" ] && [ -z "${ACT:-}" ]; then
    # Record AFTER the create succeeds, never before. CREATED_BRANCHES is the
    # cleanup loop's list of things that exist; putting a name in it up front
    # means a failed `worktree add` leaves the loop trying to delete a branch
    # that was never made, which prints "could not delete fabricated branch —
    # remove it by hand" and sends someone hunting a stray that isn't there.
    git -C "$REPO_ROOT" worktree add --force -b "$name" "$path" HEAD >/dev/null || return 1
    CREATED_BRANCHES="$CREATED_BRANCHES $name"
  else
    echo "FATAL: no local branch '$name'. This probe needs one to test the hook's" >&2
    echo "       branch check. Create it:  git fetch origin $name:$name" >&2
    echo "       (Branches are only fabricated on a real GitHub Actions runner," >&2
    echo "        where the checkout is ephemeral — never on a working repo, and" >&2
    echo "        never under act, which sets GITHUB_ACTIONS but also ACT.)" >&2
    # exit, not return: the callers add a generic "(git error above)" line, which
    # would be a lie here — no git command ran, let alone failed. Leaving by the
    # front door keeps that message for actual git failures. The EXIT trap still
    # runs, so cleanup is unaffected.
    exit 1
  fi
}

add_named_worktree "$WT" develop || {
  echo "FATAL: could not create develop worktree (git error above)" >&2
  exit 1
}
# Second worktree on a FEATURE branch: pins the hook's highest-traffic path
# (stay silent off develop/main) — the branch of the control flow that would
# regress invisibly (fail-open) if the branch check were ever broken. Started
# from HEAD rather than develop for the same checkout-shape reason.
git -C "$REPO_ROOT" worktree add --force -b probe/feature-fixture "$FEATURE_WT" HEAD >/dev/null || {
  echo "FATAL: could not create feature worktree (git error above)" >&2
  exit 1
}
# Third worktree ON main: pins the other blocking branch of the
# check (main is guarded exactly like develop).
add_named_worktree "$MAIN_WT" main || {
  echo "FATAL: could not create main worktree (git error above)" >&2
  exit 1
}

FAILURES=0

# run <expected-exit> <label> <command> [space-separated dirty relpaths]
# TARGET_WT selects the worktree (defaults to the develop one).
TARGET_WT=""
run() {
  local expected="$1" label="$2" cmd="$3" dirty="${4:-}" wt="${TARGET_WT:-$WT}" f
  for f in $dirty; do
    mkdir -p "$wt/$(dirname "$f")"
    printf 'probe\n' > "$wt/$f"
  done
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | CLAUDE_PROJECT_DIR="$wt" "$HOOK" >/dev/null 2>&1
  local actual=$?
  for f in $dirty; do
    rm -f "$wt/$f"
  done
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# run_reason <expected-reason-substring> <label> <command>
# The exit-code table CANNOT discriminate the taskopen branch: every `TASK-N`
# subject also opens uppercase, so the subject-case rule blocks it even with
# taskopen deleted. Asserting the banner's REASON is what pins the branch.
run_reason() {
  local needle="$1" label="$2" cmd="$3" wt="${TARGET_WT:-$WT}" out
  out=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | CLAUDE_PROJECT_DIR="$wt" "$HOOK" 2>&1 >/dev/null)
  if printf '%s' "$out" | grep -qF "$needle"; then
    printf 'PASS  (reason)  %s\n' "$label"
  else
    printf 'FAIL  (reason missing: %s)  %s\n' "$needle" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

CANONICAL_HEREDOC='git add -A && git commit -m "$(cat <<'\''EOF'\''
feat(ai-worker): add pgvector memory retrieval

Body mentioning git commit and TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 in prose.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"'

EARLY_HEREDOC='cat <<EOF > notes.txt
some generated content
EOF
git commit -m "x"'

run 2 "plain single-line commit, dirty ts"        'git add -A && git commit -m "x"'                        'services/probe.ts'
run 2 "CANONICAL heredoc commit form, dirty ts"   "$CANONICAL_HEREDOC"                                     'services/probe.ts'
run 2 "heredoc earlier in compound, dirty ts"     "$EARLY_HEREDOC"                                         'services/probe.ts'
run 2 "git -C global-flag form, dirty ts"         'git -C /some/path commit -m "x"'                        'services/probe.ts'
run 2 "escape token in MESSAGE prose only"        'git commit -m "prose TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1"' 'services/probe.ts'
run 2 "dirty .claude/rules carve-out"             'git commit -m "x"'                                      '.claude/rules/probe.md'
run 2 "dirty workflow yml"                        'git commit -m "x"'                                      '.github/workflows/probe.yml'
run 2 "dirty json manifest"                       'git commit -m "x"'                                      'packages/probe/package.json'
run 2 "dirty .mts module"                         'git commit -m "x"'                                      'services/probe.mts'
run 2 "dirty .cts module"                         'git commit -m "x"'                                      'services/probe.cts'
run 2 "dirty yaml config"                         'git commit -m "x"'                                      'services/probe/config.yaml'
run 2 "dirty Dockerfile"                          'git commit -m "x"'                                      'services/probe/Dockerfile'

# --- the quote scanner ------------------------------------------------------
# An EARLIER quoted argument carrying an apostrophe used to erase the whole
# `git commit` that followed it. Measured against the two-pass strip this
# replaces: the first case stripped to `echo S`, detection returned False, and
# the guard exited 0 — an unreviewed code commit on develop because someone
# wrote a contraction. The ordering matters and both directions are pinned:
# apostrophes AFTER the commit were always harmless (the swallow happens
# downstream of the match), so a one-sided case would pass on the OLD code too.
run 2 "apostrophe in an EARLIER quoted arg"       'echo "it'"'"'s" && git commit -m "won'"'"'t"'            'services/probe.ts'
run 2 "apostrophe only AFTER the commit"          'git commit -m "won'"'"'t"'                               'services/probe.ts'
# The mirror direction, and it is honestly labelled: this case passes on the OLD
# two-pass code too (that version stripped single-quoted spans FIRST, so this
# shape never reached the double-quote pass). It is here to pin the mirror
# against a future "fix" that swaps the pass order back — which is the tempting
# wrong repair, because swapping makes the apostrophe case above pass while
# breaking this one.
run 2 "double quote inside single-quoted arg"     "echo 'say \"hi\"' && git commit -m x"                    'services/probe.ts'

# --- command substitutions nested inside quotes -----------------------------
# A BYPASS of this blocking hook, measured in all three forms: bash executes the
# inner command in every one, but the quote strip erases a substitution nested
# inside a quoted argument, so the first two stripped to `echo S` and the guard
# exited 0. Wrapping a captured commit result in a status echo needs no
# adversarial intent — it is an ordinary shape.
run 2 "quoted \$( ) substitution around a commit"  'echo "$(git commit -m x)"'                              'services/probe.ts'
run 2 "quoted backtick substitution around a commit" 'echo "`git commit -m x`"'                             'services/probe.ts'
# The control: unquoted was always detected, because the strip leaves it intact.
# Without this row a regression that broke only the quoted forms would look like
# a whole-feature failure rather than the narrower thing it is.
run 2 "unquoted substitution was already detected"  'echo $(git commit -m x)'                               'services/probe.ts'

# The other half of the substitution scan, and the reason it strips heredoc
# bodies first: a commit MESSAGE discussing git commit habits is data. Without
# the strip this span reads as a commit invocation and an innocent `echo`
# blocks. The escape token is exact-case and this body carries none, so the
# verdict here comes from the strip and nothing else.
SPAN_HEREDOC_PROSE='echo "$(cat <<'\''EOF'\''
notes about git commit habits on this repo
EOF
)"'
run 0 "heredoc BODY inside a span is not a commit"  "$SPAN_HEREDOC_PROSE"                                   'services/probe.ts'

# THE ACCEPTED OVER-ARM, pinned as behaviour rather than left in a comment. A
# span inside SINGLE quotes is inert prose to bash, and the extraction reads it
# anyway, so this blocks an `echo`. Over-arming is the recoverable direction for
# a blocking guard and the escape hatch covers it; the row exists so the next
# reader who hits the false positive finds it named instead of hunting a bug.
run 2 "a span in SINGLE quotes blocks too (accepted)"  "echo 'run \$(git commit)'"                          'services/probe.ts'

# A non-heredoc quoted argument INSIDE a span that merely mentions the target
# is prose, not an invocation — the span scan strip_quoteds each span exactly as
# the top level does. Capturing the output of a command whose --body text says
# "git commit" is an ordinary shape; without the per-span strip it would falsely
# block a command that runs no git at all.
run 0 "quoted prose in a span is not a commit"      'RESULT=$(gh pr comment 5 --body "reminder: git commit early and often")' 'services/probe.ts'

# A BARE heredoc (not inside a substitution) whose body mentions $(git commit)
# as prose — the exact shape this repo's own hook-dev commit messages produce.
# The helper strips heredoc bodies from the WHOLE raw command before extracting
# spans, so the $(git commit) sitting in inert data is gone before it can be
# pulled out as a span. A per-span strip could not see it (the extracted span
# carries no heredoc marker).
BARE_HEREDOC_SUBST='cat <<'\''EOF'\'' > docs/notes.md
We fixed the $(git commit -m x) bypass.
EOF'
run 0 "a bare heredoc body mentioning a commit substitution is data" "$BARE_HEREDOC_SUBST" 'services/probe.ts'

# BYPASS REGRESSION: an UNTERMINATED `<<WORD`-shaped string in earlier quoted
# prose must not truncate the real commit substitution that follows. The whole-
# command heredoc strip keeps the tail on an unterminated opener, so the real
# $(git commit) span survives and blocks. (Dropping the tail was a measured
# bypass — the guard exited 0 on a live commit.)
UNTERM_HEREDOC_BYPASS='echo "notes: <<EOF"
echo "$(git commit -m x)"'
run 2 "unterminated heredoc opener does not truncate a later commit span" "$UNTERM_HEREDOC_BYPASS" 'services/probe.ts'

# --- line continuations -----------------------------------------------------
# Breaking a long invocation across lines with `\` is an ordinary style choice,
# not obfuscation — and it defeated detection outright: the scanner emitted a
# placeholder where bash emits nothing, so `git` and `commit` were no longer
# adjacent and the guard exited 0 on a real commit. The flag-carrying variant is
# the realistic one, since long `-C <path>` invocations are what get wrapped.
run 2 "line continuation before the subcommand"   "$(printf 'git \\\n  commit -m "x"')"       'services/probe.ts'
run 2 "line continuation after a global flag"     "$(printf 'git -C /some/path \\\n  commit -m x')" 'services/probe.ts'
# The splice must also produce the NON-match: with no space around it, bash
# joins the words into one token and `gitcommit` is not a commit.
run 0 "continuation joining words is not a commit" "$(printf 'git\\\ncommit -m x')"          'services/probe.ts'

# --- case-insensitivity -----------------------------------------------------
# Both the bash pre-filters and the python regex had to change: a case-sensitive
# pre-filter short-circuits before python runs, so fixing the regex alone fixes
# nothing. Mixed case is the case that catches a half-fix on either side.
run 2 "uppercase GIT COMMIT"                      'GIT COMMIT -m "x"'                                      'services/probe.ts'
run 2 "mixed-case Git Commit"                     'Git Commit -m "x"'                                      'services/probe.ts'
run 2 "uppercase behind a global flag"            'GIT -C /some/path COMMIT -m "x"'                        'services/probe.ts'

# The shared lib is a runtime dependency of this hook, and a missing one fails
# OPEN. Nothing above distinguishes "lib present" from "lib gone" on the ALLOW
# cases, so this asserts the import path itself rather than trusting it.
if [ ! -f "$SCRIPT_DIR/lib/shell_quotes.py" ]; then
  echo "FAIL  shared lib .claude/hooks/lib/shell_quotes.py is missing" >&2
  FAILURES=$((FAILURES + 1))
fi
# Plumbing subcommands are not `git commit`: `-` is a non-word character, so
# a bare `commit\b` matched them and blocked a tree-writing plumbing call.
run 0 "plumbing: git commit-tree stays silent"    'git commit-tree abc1234 -m x'                           'services/probe.ts'
run 0 "plumbing: git commit-graph stays silent"   'git commit-graph write'                                 'services/probe.ts'
run 0 "plumbing: commit-tree behind -C flag"      'git -C /some/path commit-tree abc1234'                  'services/probe.ts'
# The escape token is exact-case while DETECTION is case-insensitive, and that
# asymmetry is deliberate (env var names are case-sensitive in bash). It was
# argued at length in a comment and pinned by nothing, which is the one claim in
# this hook that had no test. It needs one precisely because the asymmetry looks
# like an oversight: a future contributor "fixing" it with (?i) would let
# `tzurot_allow_...=1` unlock the guard while the REAL variable was never set —
# an unreviewed commit, from a change that looks like a consistency cleanup.
run 2 "lowercase escape token does NOT unlock"    'tzurot_allow_develop_code_commit=1 git commit -m "x"'   'services/probe.ts'
run 2 "mixed-case escape token does NOT unlock"   'Tzurot_Allow_Develop_Code_Commit=1 git commit -m "x"'   'services/probe.ts'

run 0 "escape hatch in command position"          'TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 git commit -m "x"'   'services/probe.ts'
run 0 "escape hatch, canonical heredoc form"      "TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 $CANONICAL_HEREDOC"  'services/probe.ts'
run 0 "non-git command"                           'echo hello'                                             'services/probe.ts'

# --- pathological flag runs must not hang the session ---------------------
# The flag-value group here carried the same ambiguity that was MEASURED
# backtracking exponentially in the sibling lossy-pipe-guard: with a bare `\S+`
# value, every token in a run of flags can be read either as the previous flag's
# value or as a new flag, so a FAILING match explores exponentially many
# partitions — 26 dummy flags took 231ms there, doubling every two, and ~34
# would hang for minutes.
#
# This hook is PreToolUse on every Bash call AND it blocks, so a hang here is
# strictly worse than in the advisory sibling.
#
# TWO THINGS THIS CASE GOT WRONG, both fixed together because either alone
# leaves it useless:
#
# 1. The fixture reached nothing. `-x0 -x1 …` is SINGLE-dash, and the
#    re-partitioning that actually blows this pattern up comes from `-{1,2}`
#    on a DOUBLE dash (`--flag` = `--`+`flag` or `-`+`-flag`). The case passed
#    in milliseconds while the real shape ran for minutes, and it would not
#    have noticed the fix being reverted. Now double-dash, each with a value.
#
# 2. The bound was measured, not enforced. A wall clock read AFTER the call
#    cannot catch a hang — it can only report one that already finished.
#    Catastrophic backtracking does not finish, so this case would have wedged
#    the probe until guard:hook-probes' 120s ceiling killed the whole job, with
#    no attributable diagnostic. `timeout` turns that into exit 124 and a named
#    failure. (The sibling probe learned this first; this copy did not get the
#    lesson until a reviewer noticed the asymmetry.)
#
# Bounded on wall clock rather than on a verdict, because the verdict was
# always correct — it just took forever to reach.
long_flags=$(python3 -c "print(' '.join(f'--flag{i} val{i}' for i in range(60)))")
redos_start=$(date +%s%N)
jq -n --arg c "git $long_flags nocommit" \
  '{tool_name:"Bash",tool_input:{command:$c}}' \
  | timeout 10 "$HOOK" >/dev/null 2>&1
redos_rc=$?
redos_ms=$(( ($(date +%s%N) - redos_start) / 1000000 ))
if [ "$redos_rc" -eq 124 ]; then
  printf 'FAIL  (timed out at 10s)  pathological flag run is backtracking\n'
  FAILURES=$((FAILURES + 1))
elif [ "$redos_rc" -ne 0 ]; then
  printf 'FAIL  (exit %d, expected 0)  60 dummy flags\n' "$redos_rc"
  FAILURES=$((FAILURES + 1))
elif [ "$redos_ms" -ge 2000 ]; then
  printf 'FAIL  (%dms, expected <2000ms)  pathological flag run is backtracking\n' "$redos_ms"
  FAILURES=$((FAILURES + 1))
else
  printf 'PASS  (%dms)  60 dummy flags stays well inside the bound\n' "$redos_ms"
fi
# Raw-payload pre-check boundary: the hook exits before forking jq when the RAW
# stdin has no git…commit token pair. `git status` has no `commit` at all;
# `echo commit && git status` has the tokens in the WRONG ORDER, and the glob
# needs git BEFORE commit — matching the decoded check it replaces. Both must
# stay silent, and a commit whose tokens sit behind a chain must still block
# (covered by the blocking cases above).
run 0 "pre-check: git verb with no commit token"  'git status --porcelain'                                 'services/probe.ts'
run 0 "pre-check: tokens in the wrong order"      'echo commit && git status'                              'services/probe.ts'
run 0 "clean tree commit"                         'git add -A && git commit -m "x"'
run 0 "docs-only dirty file"                      'git commit -m "x"'                                      'docs/probe-notes.md'
# Accepted-tradeoff pin: dirty-tree (not staged-set) design means an
# incidental lockfile diff blocks even a doc-only commit — escape hatch or
# stash is the sanctioned path.
run 2 "mixed tree: doc + incidental lockfile"     'git commit -m "x"'                                      'docs/probe-notes.md probe-lock.yaml'
# Highest-traffic path: feature branches never block, whatever is dirty.
TARGET_WT="$FEATURE_WT"
run 0 "feature branch, dirty ts stays silent"     'git add -A && git commit -m "x"'                        'services/probe.ts'
TARGET_WT=""

# Main is guarded exactly like develop.
TARGET_WT="$MAIN_WT"
run 2 "main branch, dirty ts blocks"              'git add -A && git commit -m "x"'                        'services/probe.ts'
TARGET_WT=""

# Rename decomposition: a staged gated→non-gated rename must still block.
# Without --no-renames it renders as one `R old.ts -> new.md` line whose
# END is the non-gated extension — the historical slip; decomposed D/A
# lines check the .ts side independently. Uses a real tracked .ts and a
# hard reset scoped to the throwaway probe worktree.
git -C "$WT" mv services/bot-client/src/index.ts docs/probe-renamed.md 2>/dev/null
jq -n '{tool_name:"Bash",tool_input:{command:"git commit -m \"x\""}}' \
  | CLAUDE_PROJECT_DIR="$WT" "$HOOK" >/dev/null 2>&1
RENAME_EXIT=$?
git -C "$WT" reset -q --hard HEAD
if [ "$RENAME_EXIT" -eq 2 ]; then
  printf 'PASS  (exit 2)  staged gated→non-gated rename blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  staged gated→non-gated rename blocks\n' "$RENAME_EXIT"
  FAILURES=$((FAILURES + 1))
fi

# Malformed tool input fails OPEN (visibility guard, never a work-stopper).
printf 'not json at all' | CLAUDE_PROJECT_DIR="$WT" "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  malformed tool-input fails open\n'
else
  printf 'FAIL  malformed tool-input should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

# --- commit header pre-check ------------------------------------------
# Isolates the header check from the develop/gated-file check below it: no
# case here passes a dirty file, so a bad header must block on a CLEAN tree
# (the header runs BEFORE the branch/gated-file gate) and a good header must
# exit 0 with nothing dirty at all.

# Exactly 101 characters: "feat: " (6) + 95 'w' characters = 101 — one over
# commitlint's header-max-length of 100.
SUBJECT_101="feat: $(printf 'w%.0s' $(seq 1 95))"
# Exactly 100 characters (the boundary, one under the block) — the
# discriminating pair against SUBJECT_101: without this case, the length
# check could be `>= 100` or `> 90` and nothing here would notice.
SUBJECT_100="feat: $(printf 'w%.0s' $(seq 1 94))"
# A valid lowercase 90-character subject.
SUBJECT_90="feat: $(printf 'w%.0s' $(seq 1 84))"

# A SECOND, distinct over-length subject (105 chars, different prefix and
# fill word) so this case's ack key never collides with SUBJECT_101's —
# the ack key hashes the SUBJECT text, and a shared key would let the first
# case's block silently ack the second.
SUBJECT_105_HEREDOC="docs: $(printf 'q%.0s' $(seq 1 99))"

# The canonical heredoc commit form carrying the over-length first line
# instead of a short one. \$ is escaped so bash does not attempt the
# substitution while building this string — the resulting value is inert
# text, exactly like CANONICAL_HEREDOC above.
HEREDOC_LONG_SUBJECT="git add -A && git commit -m \"\$(cat <<'EOF'
$SUBJECT_105_HEREDOC

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)\""

run 2 "101-char subject blocks (header-max-length)"         "git commit -m \"$SUBJECT_101\""
run 0 "100-char subject at the boundary passes"              "git commit -m \"$SUBJECT_100\""
run 2 "subject opens with a task id"                          'git commit -m "TASK-12 foo"'
# Discriminates the taskopen BRANCH, which the exit-code case above cannot:
# with taskopen deleted the commit still blocks (subject-case catches the
# uppercase T), so only the reason text distinguishes the two rules.
run_reason "opens with a task id" "task-id opener reports the taskopen reason, not subject-case" 'git commit -m "TASK-13 bar"'
run 2 "subject starts uppercase"                              'git commit -m "Fix: x"'
run 0 "valid lowercase 90-char subject passes"                "git commit -m \"$SUBJECT_90\""
run 0 "heredoc form with a valid subject passes"              "$CANONICAL_HEREDOC"
run 2 "heredoc form with an over-length 105-char subject blocks" "$HEREDOC_LONG_SUBJECT"
# commitlint subject-case fires on the FIRST character of the subject, which
# is lowercase here ("f" of "feat") — the violation is in the remainder
# after the conventional-commit prefix is stripped ("Add thing").
run 2 "subject-case: uppercase after a conventional-commit prefix blocks" 'git commit -m "feat(scope): Add thing"'

# --- header subject extraction is scoped to the commit's OWN segment -------
# An earlier command's own -m in the same chain (e.g. `git stash push -m
# "..."`) must not supply the "subject" the header check evaluates — that
# earlier value has nothing to do with the actual `git commit` invocation.
# REGRESSION CASE: the earlier -m opens uppercase; the real commit's subject
# is fine, so this must NOT block.
run 0 "chained -m before the real commit does not supply its subject" \
  'git stash push -m "WIP before rebase" && git commit -m "feat: x"'
# The mirror: an earlier -m is fine, but the chain's LAST real `git commit`
# carries the bad subject — pins that the fix did not simply disable the
# check by always grabbing the FIRST commit-shaped segment.
run 2 "the chain's actual last commit still blocks on its own subject" \
  'git commit -m "fine one" && git commit -m "Bad Subject"'
# Every commit segment is evaluated, not just the last one: a bad FIRST
# commit blocks even though the chain also carries a later clean one — a
# chain halts at its first rejected commit, so that first bad subject is the
# one a developer actually hits. Distinct subjects per case (exit-code vs.
# reason) so neither shares an ack key with the other new cases above.
run 2 "the chain's FIRST commit blocks even with a later clean one" \
  'git commit -m "Reversed Bad Subject One" && git commit -m "fine two"'
run_reason "Reversed Bad Subject Two" "reversed-order reason names the FIRST segment's subject, not the second" \
  'git commit -m "Reversed Bad Subject Two" && git commit -m "fine three"'

# --- header check does not fire on a SUBSTITUTION-ONLY match ---------------
# REGRESSION CASE: a `sed` replacement quoting a commit EXAMPLE in backticks,
# joined to a preceding `-m` by sed's own `\&` escaping (needed to emit a
# literal `&` rather than sed's "whole match" meaning). The whole `s|...|`
# argument is single-quoted, so bash never executes any of this — the
# backticks are inert prose describing a shell command, not a real
# invocation. Detection still fires (the accepted single-quote-span over-arm
# above), but the header check must not: it used to run on the full raw
# command anyway, and its own chain-split does not recognize `\&\&` as a
# separator, so it picked up the stash's `-m` (the FIRST one in the glued
# segment) as though it were the quoted commit's subject and blocked on text
# nobody ever committed.
BACKTICKED_COMMIT_EXAMPLE='sed -i '"'"'s|old|see (`git stash push -m "WIP before rebase" \&\& git commit -m "feat: x"`) here|'"'"' body.md'
run 0 "backticked commit example joined by escaped && is not a real commit" "$BACKTICKED_COMMIT_EXAMPLE"

# The bare-parenthesis sibling — identical text minus the backticks, so no
# substitution span exists at all and detection never fires by any path.
# Already passed before the fix; pinned here so the fix is not mistaken for
# having achieved case1 by disabling the header check outright.
BARE_COMMIT_EXAMPLE='sed -i '"'"'s|old|see (git stash push -m "WIP before rebase" \&\& git commit -m "feat: x") here|'"'"' body.md'
run 0 "bare-parenthesis equivalent (no substitution span) also passes" "$BARE_COMMIT_EXAMPLE"

# DISCRIMINATION: a REAL commit with its own bad subject, in the SAME command
# as backticked prose quoting a DIFFERENT commit's subject. Proves the fix
# narrows the header check's trigger rather than suppressing it outright —
# the real, top-level `git commit` still gets checked and still blocks, on
# its OWN subject, never the quoted example's. Two distinct subjects (exit-
# code vs. reason) so neither call's ack key silently absorbs the other's.
run 2 "a real bad commit blocks on its own subject beside quoted prose" \
  'git commit -m "Never Should Surface One" && sed -i '"'"'s|old|see (`git stash push -m "WIP before rebase" \&\& git commit -m "feat: x"`) here|'"'"' body.md'
run_reason "Never Should Surface Two" "reason names the REAL commit's subject, not the quoted example's" \
  'git commit -m "Never Should Surface Two" && sed -i '"'"'s|old|see (`git stash push -m "WIP before rebase" \&\& git commit -m "feat: x"`) here|'"'"' body.md'

# --- header check is independent of the develop/main escape hatch ----------
# TZUROT_ALLOW_DEVELOP_CODE_COMMIT unlocks the gated-file/branch gate only —
# the header pre-check runs on every branch and must not honour it.
run 2 "escape token does not unlock the header pre-check" \
  'TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 git commit -m "Bad Subject Two"'

# --- heredoc subject extraction recognizes --message, not just -m ----------
SUBJECT_LONG_MESSAGE="chore: $(printf 'z%.0s' $(seq 1 100))"
HEREDOC_LONG_MESSAGE="git add -A && git commit --message \"\$(cat <<'EOF'
$SUBJECT_LONG_MESSAGE

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)\""
run 2 "heredoc form via --message with an over-length subject blocks" "$HEREDOC_LONG_MESSAGE"

# --- heredoc subject extraction recognizes the --message=$(...) `=` form ---
# REGRESSION CASE: the heredoc regex required whitespace after -m/--message
# while _plain_subject accepts `=` too. `--message=$(cat …)` used to skip the
# heredoc branch entirely, find no inline -m/--message argument on the plain-
# form fallback either, and pass an over-length subject through unchecked.
SUBJECT_LONG_MESSAGE_EQ="chore: $(printf 'y%.0s' $(seq 1 100))"
HEREDOC_EQ_LONG_MESSAGE="git add -A && git commit --message=\$(cat <<'EOF'
$SUBJECT_LONG_MESSAGE_EQ

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
run 2 "heredoc form via --message=(...) (equals, no space) with an over-length subject blocks" "$HEREDOC_EQ_LONG_MESSAGE"

# --- classification runs on quote-stripped text, not raw (the class fix) ---
# REGRESSION CASE: a `sed` replacement quoting a commit EXAMPLE in an EARLIER
# chain segment, joined by a plain `&&` (not sed's own `\&\&` escaping — that
# shape was already covered above). The naive chain-split classified segment
# 1 (the sed invocation) as a commit invocation because `is_commit_invocation`
# matched the quoted example's `git commit` tokens literally, ignoring the
# surrounding single quotes — so it extracted "Round Three Ignored Subject"
# as though IT were the real commit's subject and blocked before ever
# reaching the real, valid commit in segment 2. The fix classifies from the
# quote-stripped `cmd`, where the quoted example collapses to a placeholder
# and carries no `git`/`commit` tokens to match.
ROUND3_REPRO='sed -i '"'"'s/old/git commit -m "Round Three Ignored Subject"/'"'"' notes.md && git commit -m "feat: round three real commit"'
run 0 "quoted commit-shaped prose in an earlier segment does not block a valid later commit" "$ROUND3_REPRO"

# DISCRIMINATION: the mirror of the round-3 case, with the REAL commit's own
# subject now bad. Proves the classification fix narrows what counts as a
# commit segment rather than suppressing the header check outright — the
# real, later `git commit` still gets evaluated and still blocks, on its OWN
# subject, never the quoted example's. Distinct subjects for the exit-code
# vs. reason checks so neither call's ack key silently absorbs the other's.
ROUND3_MIRROR='sed -i '"'"'s/old/git commit -m "Round Three Ignored Subject Two"/'"'"' notes.md && git commit -m "Round Three Real Bad Subject One"'
run 2 "the mirror: a real bad commit after quoted prose in an earlier segment still blocks" "$ROUND3_MIRROR"
ROUND3_MIRROR_REASON='sed -i '"'"'s/old/git commit -m "Round Three Ignored Subject Three"/'"'"' notes.md && git commit -m "Round Three Real Bad Subject Two"'
run_reason "Round Three Real Bad Subject Two" "reason names the REAL later commit's subject, not the quoted prose's" "$ROUND3_MIRROR_REASON"

# --- the heredoc branch gets the round-3 treatment too (round-4 class fix) -
# REGRESSION CASE: round 3 fixed classification for the PLAIN -m path only —
# the heredoc branch still ran a single whole-raw `re.search` for
# `-m "$(cat <<TOKEN' ... TOKEN)"` with no check that the match sits inside an
# inert quoted span. An `echo` of the canonical commit-message form (the exact
# shape `05-tooling.md` and `/tzurot-git-workflow` document as literal prose,
# and this probe file's own $CANONICAL_HEREDOC fixture) joined by `&&` to a
# REAL, later, plain-`-m` commit put the fake example leftmost in raw, so the
# whole-raw search picked "Round Four Ignored Subject" as the header verdict's
# subject before the real commit was ever evaluated. The fix gives the
# heredoc branch the same classify-from-quote-stripped-text/extract-from-raw
# split the plain path already had, via a per-match sentinel so the chain
# split can't be shredded by the heredoc body's own embedded newlines.
ROUND4_HEREDOC_REPRO='echo '\''Canonical form: git commit -m "$(cat <<EOF
Round Four Ignored Subject
EOF
)"'\'' && git commit -m "feat: round four real commit"'
run 0 "quoted heredoc-shaped commit example in an earlier segment does not block a valid later commit" "$ROUND4_HEREDOC_REPRO"

# DISCRIMINATION: the mirror of the round-4 case, with the REAL later commit's
# own subject now bad. Proves the classification fix narrows what counts as a
# commit segment rather than suppressing the heredoc header check outright —
# the real, later `git commit` still gets evaluated and still blocks, on its
# OWN subject, never the quoted example's. Distinct subjects for the exit-code
# vs. reason checks so neither call's ack key silently absorbs the other's.
ROUND4_MIRROR='echo '\''Canonical form: git commit -m "$(cat <<EOF
Round Four Ignored Subject Two
EOF
)"'\'' && git commit -m "Round Four Real Bad Subject One"'
run 2 "the mirror: a real bad commit after quoted heredoc-shaped prose in an earlier segment still blocks" "$ROUND4_MIRROR"
ROUND4_MIRROR_REASON='echo '\''Canonical form: git commit -m "$(cat <<EOF
Round Four Ignored Subject Three
EOF
)"'\'' && git commit -m "Round Four Real Bad Subject Two"'
run_reason "Round Four Real Bad Subject Two" "reason names the REAL later commit's subject, not the quoted heredoc-shaped prose's" "$ROUND4_MIRROR_REASON"

# --- -am and other combined short-flag clusters ending in `m` --------------
# `_plain_subject`'s alternation was literal `-m`/`--message`, so
# `git commit -am "..."` matched no inline argument and the header check
# silently reported "ok" regardless of the subject. Extended to recognize a
# combined short-flag cluster ending in `m`, anchored to a fresh flag
# boundary so it cannot match mid-word inside an unrelated long flag.
run 2 "combined short flag -am carries the message argument"       'git commit -am "Bad Uppercase Subject One"'
run 2 "combined short flag -cam carries the message argument"      'git commit -cam "Bad Uppercase Subject Cam"'
run 0 "a cluster NOT ending in m is not treated as a message flag" 'git commit -ac "Bad Looking Quoted String"'
run 0 "--amend -m is unaffected by the cluster alternative"        'git commit --amend -m "totally fine amend subject"'

# --- header check runs on the feature branch too (branch-independence) -----
# The header pre-check is deliberately NOT gated behind the develop/main
# check — it runs on every branch. Every other header case above runs
# against the default develop worktree; nothing until now pinned that the
# check also fires away from develop/main, so a regression that accidentally
# moved it behind the branch gate would pass the whole suite unnoticed.
TARGET_WT="$FEATURE_WT"
run 2 "header check fires on a feature branch, not just develop/main" 'git commit -m "Feature Branch Header Subject"'
TARGET_WT=""

# Version-bump exception: tracked package.json files whose diffs touch only
# their "version" line pass; a bump touching anything else blocks; an
# untracked manifest blocks (covered above by "dirty json manifest").
bump_probe() {
  local expected="$1" label="$2" extra_edit="${3:-}"
  sed -i 's/"version": "[^"]*"/"version": "9.9.9-probe.1"/' "$WT/package.json"
  sed -i 's/"version": "[^"]*"/"version": "9.9.9-probe.1"/' "$WT/services/bot-client/package.json"
  if [ "$extra_edit" = "codefile" ]; then
    printf 'probe\n' > "$WT/services/probe.ts"
  fi
  if [ "$extra_edit" = "blank" ]; then
    printf '\n' >> "$WT/services/bot-client/package.json"
  elif [ -n "$extra_edit" ]; then
    printf '"probe": "x"\n' >> "$WT/services/bot-client/package.json"
  fi
  jq -n '{tool_name:"Bash",tool_input:{command:"git add -A && git commit -m \"x\""}}' \
    | CLAUDE_PROJECT_DIR="$WT" "$HOOK" >/dev/null 2>&1
  local actual=$?
  git -C "$WT" checkout -- package.json services/bot-client/package.json 2>/dev/null
  rm -f "$WT/services/probe.ts"
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}
bump_probe 0 "version-only bump across manifests passes"
bump_probe 2 "bump plus a non-version manifest edit blocks" extra
bump_probe 2 "bump plus a whitespace-only manifest edit blocks" blank
# The exact shape the guard exists for: a correct bump riding with real
# code — the non-manifest gated file short-circuits the exception.
bump_probe 2 "bump plus an unrelated dirty code file blocks" codefile

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
