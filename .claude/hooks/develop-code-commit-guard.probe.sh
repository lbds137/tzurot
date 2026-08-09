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
# Plumbing subcommands are not `git commit`: `-` is a non-word character, so
# a bare `commit\b` matched them and blocked a tree-writing plumbing call.
run 0 "plumbing: git commit-tree stays silent"    'git commit-tree abc1234 -m x'                           'services/probe.ts'
run 0 "plumbing: git commit-graph stays silent"   'git commit-graph write'                                 'services/probe.ts'
run 0 "plumbing: commit-tree behind -C flag"      'git -C /some/path commit-tree abc1234'                  'services/probe.ts'
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
# strictly worse than in the advisory sibling. The fix (a value may not itself
# start with `-`) preserves every verdict; this case exists so a revert cannot
# go unnoticed. Bounded on wall clock rather than on a verdict, because the
# verdict was always correct — it just took forever to reach.
long_flags=$(python3 -c "print(' '.join(f'-x{i}' for i in range(60)))")
redos_start=$(date +%s%N)
run 0 "60 dummy flags does not hang"              "git $long_flags nocommit"                               'services/probe.ts'
redos_ms=$(( ($(date +%s%N) - redos_start) / 1000000 ))
if [ "$redos_ms" -lt 2000 ]; then
  printf 'PASS  (%dms)  ...and returns well inside the 2s bound\n' "$redos_ms"
else
  printf 'FAIL  (%dms, expected <2000ms)  pathological flag run is backtracking\n' "$redos_ms"
  FAILURES=$((FAILURES + 1))
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
