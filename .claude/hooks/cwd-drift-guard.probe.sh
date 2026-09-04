#!/bin/bash
# Fixture check for cwd-drift-guard.sh — run after ANY edit to the hook.
# Asserts the exit-code table over the shapes that matter: only a bare git
# command with a repo-root-relative pathspec, run from a drifted subdir cwd,
# blocks; everything else (git -C, at-root, pnpm, no-pathspec, subdir-local
# path) passes.
#
# Colocated with the hook — it IS the hook's verification mechanism, a bash
# exit-code harness over a bash hook, run manually on hook edits.
#
# Usage: .claude/hooks/cwd-drift-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/cwd-drift-guard.sh"
export CLAUDE_PROJECT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
ROOT="$CLAUDE_PROJECT_DIR"

fail=0
check() { # $1=expected_exit $2=label $3=json
  echo "$3" | "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$1" ]; then
    echo "FAIL [$got≠$1]: $2"
    fail=1
  else
    echo "ok   [$got]: $2"
  fi
}

check 2 "drift + repo-root-relative pathspec" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 2 "drift + bare root-file pathspec (CURRENT.md)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add CURRENT.md\"},\"cwd\":\"$ROOT/services/bot-client\"}"
check 0 "git -C is root-anchored" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git -C $ROOT add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "shell at repo root (no drift)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT\"}"
check 0 "pnpm from a subdir is legitimate" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm --filter @tzurot/tooling test\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "git with no pathspec (status)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "subdir-local pathspec (no repo-root prefix)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "path-like substring only INSIDE a quoted commit message (not a pathspec)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"docs: update packages/tooling/README\\\"\"},\"cwd\":\"$ROOT/services/bot-client\"}"
check 0 "self-correcting: leading cd to root before the git command" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd \\\"\$CLAUDE_PROJECT_DIR\\\" && git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 2 "drift + .github pathspec (allowlist completeness)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add .github/workflows/ci.yml\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# Two apostrophes STRADDLING a real pathspec. Under the two-pass sed strip this
# replaces, they paired as a single-quoted span and deleted `packages/…` along
# with everything else between them, so the drift went unwarned. The stateful
# scanner sees both as literal text inside their own double-quoted arguments.
check 2 "apostrophes straddling a real pathspec" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"it's\\\" && git add packages/tooling/x.ts && echo \\\"don't\\\"\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# The complement: with the scanner in place, a path-like substring that lives
# ONLY inside quotes must still be invisible. Without this, a scanner that
# stripped nothing at all would pass the case above.
check 0 "apostrophes, and the only path is inside quotes" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"it's packages/tooling\\\" && echo \\\"don't\\\"\"},\"cwd\":\"$ROOT/services/bot-client\"}"
# Uppercase is a shape the shell accepts, and the detection grep was the last
# case-sensitive `git` gate left in this class after the sibling guards were
# fixed. Without -i this exits 0 and the drift goes unwarned.
check 2 "uppercase GIT is still detected" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT ADD packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# The anchored form must stay exempt in EITHER case. Making the detector
# case-insensitive without this exemption sent a correctly-anchored uppercase
# command into a false block — the regression that motivated this pair.
check 0 "uppercase but root-anchored is exempt" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT -C $ROOT add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "uppercase --git-dir is exempt" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT --git-dir=$ROOT/.git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# The NEGATIVE half of the exemption, and its absence is what let a `grep -i`
# fold `-C` into `-c`. Those are different flags: `-C <path>` anchors the
# working directory, `-c key=val` overrides config and anchors nothing. This
# repo's own hooks run the `-c` form, so folding them silently dropped the
# drift check for a live shape. Both cases are exempt-direction assertions,
# so only this one can catch the fold.
check 2 "config -c does NOT exempt (it anchors nothing)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git -c core.pager=cat add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 2 "uppercase GIT -c also does NOT exempt" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT -c core.pager=cat add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# `--git-dir` needs a trailing boundary like `-C` has, or a longer flag that
# merely starts with it reads as root-anchored.
check 2 "--git-directory is NOT --git-dir" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git --git-directory=x add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# Quoted text merely CONTAINING the anchor flag must not exempt the real
# invocation beside it — the exemption reads the stripped command for exactly
# this reason. This is the quote-content-leaks-into-a-structural-scan class
# the whole PR is about, in the one hook where it survived longest.
check 2 "quoted \"git -C\" does not exempt real drift" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"see git -C /somewhere\\\" && git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "no cwd in payload (fail-safe)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"}}"
check 0 "non-Bash tool" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"x\"},\"cwd\":\"$ROOT/packages/tooling\"}"

# ---------------------------------------------------------------------------
# A `cd` INSIDE the command. The guard reads the shell's cwd as it is when the
# command STARTS, so a chain that changes directory itself used to be invisible
# to it — the blanket allow-on-`cd` below was the whole handling. The shape that
# got through is the one with the highest cost:
#
#   cd packages/x && npx vitest … && git checkout -- packages/x/src/File.ts
#
# The git step runs from packages/x, the repo-relative pathspec resolves to
# packages/x/packages/x/… and matches nothing — and since these are canary
# reverts, the failure leaves a deliberate mutation applied to a production
# source file, after the test output that would have shown it has scrolled by.
#
# None of these fixtures needs the directories to exist: the resolution is
# textual, so it cannot follow a symlink and does not touch the filesystem.
# ---------------------------------------------------------------------------
check 2 "cd into a package dir, then a repo-relative git pathspec later in the chain" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd packages/identity && npx vitest run src/x.test.ts && git checkout -- packages/identity/src/PersonalityService.ts\"},\"cwd\":\"$ROOT\"}"
# The two shapes the task calls out as MUST-PASS, and they are the ones that
# make the case above attributable: without them a guard that blocked every
# `cd` chain would look identical.
check 0 "cd then git -C is still root-anchored" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd packages/identity && git -C $ROOT checkout -- packages/identity/src/x.ts\"},\"cwd\":\"$ROOT\"}"
check 0 "cd then a chain with no git step at all" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd packages/identity && npx vitest run src/x.test.ts\"},\"cwd\":\"$ROOT\"}"
# The resolution is a real path join, not a prefix test: a `..` segment has to
# collapse or a chain that walks sideways between packages reads as the wrong
# directory.
check 2 "a relative cd through .. still resolves to the drifted dir" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd ../identity && git checkout -- packages/identity/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# Self-correction in its literal form. The `\$CLAUDE_PROJECT_DIR` fixture above
# covers the variable spelling, which is deliberately NOT resolved; this covers
# the spelled-out one, which is.
check 0 "cd to the repo root by absolute path self-corrects" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd $ROOT && git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "cd out of the repo entirely is not this hook's concern" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd /tmp && git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# An ESCAPED separator inside the `cd` target. The separator strip runs before
# the unresolvable-shape classification and does not know about escaping, so it
# truncated this target to `foo\` — a fragment matching no unresolvable pattern,
# which then resolved to a directory the command never enters. Measured before
# the fix: exit 2, with the banner naming `foo\` as the drifted subdir. The
# invariant is that this hook never computes a WRONG effective cwd; where it
# cannot read the target it falls open.
#
# The cwd is a DRIFTED subdir rather than the repo root so the 0 is
# attributable: from the root, a hook that had dropped `cd` handling altogether
# would reach the no-drift exit and pass this for the wrong reason. From here
# that exit is unreachable, so only the unresolvable-target classification can
# produce a 0.
check 0 "an escaped separator in a cd target falls open, not to a truncated path" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd foo\\\\&bar && git add packages/x/y.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"

# ---------------------------------------------------------------------------
# Worktree-shaped fixtures. Both the toplevel exemption and the tracker-write
# refusal need a REAL linked worktree on disk — only git can tell a worktree
# root from any other directory. Built INSIDE the repo on purpose: from a temp
# dir the "drifted outside the repo" bail above fires first and every case
# below would pass without the gate under test ever running.
# ---------------------------------------------------------------------------
WT_BASE="$ROOT/.probe-cwd-drift.$$"
trap 'rm -rf "$WT_BASE"' EXIT
WT_MAIN="$WT_BASE/main"
WT_ROOT="$WT_MAIN/.claude/worktrees/agent-probe"
mkdir -p "$WT_MAIN"
git init -q "$WT_MAIN" >/dev/null 2>&1
git -C "$WT_MAIN" -c user.email=probe@example.invalid -c user.name=probe \
  commit -q --allow-empty -m init >/dev/null 2>&1
git -C "$WT_MAIN" worktree add -q -b probe-fixture "$WT_ROOT" >/dev/null 2>&1
mkdir -p "$WT_ROOT/packages/x"

if [ ! -e "$WT_ROOT/.git" ]; then
  # Without this the cases below would run against a plain directory and the
  # exemption ones would pass for the wrong reason — the vacuous pass this
  # file refuses everywhere else.
  echo "FAIL [setup]: could not build the worktree fixture"
  fail=1
else
  # An agent worktree's root is not drift: its cwd never equals
  # CLAUDE_PROJECT_DIR and its `.git` is a FILE, so neither check above can see
  # it — yet a repo-relative pathspec from there resolves exactly as it does
  # from the main checkout's root. Every dispatched agent was paying a false
  # block or a `git -C` workaround for this.
  check 0 "a worktree ROOT is a git toplevel, not drift" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git diff packages/x\"},\"cwd\":\"$WT_ROOT\"}"
  # The complement, and the one that keeps the exemption from swallowing the
  # hook's whole purpose: a subdirectory of a worktree is drift like any other.
  check 2 "a package subdir INSIDE a worktree is still drift" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/x/y.ts\"},\"cwd\":\"$WT_ROOT/packages/x\"}"

  # The tracker store belongs to the main checkout. A mutation run from a
  # worktree writes the task file into the WORKTREE's tracker/, invisible to
  # every query — and the id it is issued is the one the worktree's base knew,
  # so it collides. `pnpm` is otherwise never blocked here, so the match is
  # narrow: mutating subcommands only.
  check 2 "tracker task mutation from a worktree root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker task create 'Title'\"},\"cwd\":\"$WT_ROOT\"}"
  check 2 "tracker doc mutation from a worktree root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker doc create 'Idea: x'\"},\"cwd\":\"$WT_ROOT\"}"
  check 2 "tracker mutation from a subdir of a worktree" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker task edit 42 -s Done\"},\"cwd\":\"$WT_ROOT/packages/x\"}"
  # THE ORDERING PIN. `pnpm tracker …` carries no `git ` token, so the
  # git-presence short-circuit further down exits 0 on it — measured: before
  # the tracker check existed this exact fixture returned 0, and that is the
  # gate it returned 0 at. Placing the check anywhere below that line, or below
  # the no-drift exits, makes it dead code.
  check 2 "the tracker check runs before every downstream early exit" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker task archive 42\"},\"cwd\":\"$WT_ROOT\"}"
  # Read-only tracker work is how a worktree agent looks things up; blocking it
  # would make the guard worse than the bug.
  check 0 "tracker read-only query from a worktree root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker task list --plain\"},\"cwd\":\"$WT_ROOT\"}"
  check 0 "tracker doc search from a worktree root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker doc search hooks\"},\"cwd\":\"$WT_ROOT\"}"
  # The worktree half of the condition, isolated: the same command from a
  # MAIN-checkout cwd must pass. It uses the fixture's own main checkout rather
  # than $ROOT/packages/tooling, because $ROOT is itself a worktree whenever
  # this probe runs from one — a fixture whose verdict depends on where the
  # suite was invoked pins nothing.
  #
  # The SUBDIRECTORY spelling specifically: there, git reports an absolute
  # `--git-dir` beside a RELATIVE `--git-common-dir`, so a comparison without
  # `--path-format=absolute` reads a plain main checkout as a worktree. Only
  # this case can catch that.
  mkdir -p "$WT_MAIN/sub"
  check 0 "tracker mutation from a main-checkout subdir" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker task create 'Title'\"},\"cwd\":\"$WT_MAIN/sub\"}"
  check 0 "tracker mutation from a main-checkout root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm tracker task create 'Title'\"},\"cwd\":\"$WT_MAIN\"}"
  # The command half, isolated. Quoted text must not decide a structural
  # question — the same property the `git -C` exemption already relies on.
  check 0 "a tracker mutation only QUOTED is not a mutation" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo \\\"pnpm tracker task create x\\\"\"},\"cwd\":\"$WT_ROOT/packages/x\"}"

  # A WRAPPER executes its string argument, so the quote-strip that correctly
  # makes the `echo` case above inert must not make these inert too. Both halves
  # of the old check missed them: the raw prefilter's preceding-character class
  # excluded quotes, and the confirming grep ran on the quote-STRIPPED command,
  # where the wrapper's argument had already been replaced by a placeholder.
  check 2 "tracker mutation wrapped in bash -c from a worktree root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"bash -c \\\"pnpm tracker task create Title\\\"\"},\"cwd\":\"$WT_ROOT\"}"
  check 2 "tracker mutation wrapped in sh -c from a worktree subdir" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"sh -c 'pnpm tracker doc create x'\"},\"cwd\":\"$WT_ROOT/packages/x\"}"
  check 2 "tracker mutation wrapped in eval from a worktree root" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"eval \\\"pnpm tracker task edit 42 -s Done\\\"\"},\"cwd\":\"$WT_ROOT\"}"
  # An env-assignment PREFIX does not consume command position: bash applies it
  # to the wrapper, so the wrapper is still a wrapper and its argument is still
  # a command. Read as the command name instead, the assignment hid every
  # wrapper standing behind one and this refusal silently stopped happening —
  # the same shape as the unprefixed `bash -c` case above, which is why the two
  # are asserted together rather than this one standing alone.
  check 2 "tracker mutation wrapped in an assignment-prefixed bash -c" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"FOO=1 bash -c \\\"pnpm tracker task create Title\\\"\"},\"cwd\":\"$WT_ROOT\"}"
  # The command half of the wrapper cases, isolated: unwrapping must not turn
  # every `bash -c` into a block. A read-only query inside the wrapper is still
  # read-only.
  check 0 "a wrapped tracker QUERY is still not a mutation" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"bash -c \\\"pnpm tracker task list --plain\\\"\"},\"cwd\":\"$WT_ROOT\"}"
  # The worktree half of the wrapper cases, isolated, in the fixture's own main
  # checkout for the same reason the unwrapped main-checkout cases use it.
  check 0 "a wrapped tracker mutation from a main-checkout cwd is fine" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"bash -c \\\"pnpm tracker task create Title\\\"\"},\"cwd\":\"$WT_MAIN\"}"
  # A wrapper running an `echo` BLOCKS, and the pair below is why that is the
  # right answer rather than a defect: unwrapping makes the wrapper's argument a
  # command in its own right, and this guard has always read an unquoted
  # `pnpm tracker …` inside an `echo` argument as a mutation. The two fixtures
  # assert the same verdict for the same shape wrapped and unwrapped, so the
  # wrapper adds no new inconsistency; narrowing the match to command position
  # would have to change BOTH, which is a different finding than this one.
  check 2 "an unquoted tracker mutation after echo blocks (pre-existing shape)" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo pnpm tracker task create x\"},\"cwd\":\"$WT_ROOT\"}"
  check 2 "the same shape wrapped in bash -c blocks identically" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"bash -c \\\"echo pnpm tracker task create x\\\"\"},\"cwd\":\"$WT_ROOT\"}"

  # A tracker mutation behind a `cd` whose TARGET the hook cannot read. The
  # unresolvable-`cd` branch allows the command for the DRIFT checks, and the
  # tracker refusal has to run before that allow — otherwise the hook's own
  # recommended self-correction (`cd "$CLAUDE_PROJECT_DIR" && …`) is the one
  # shape that bypasses it, and for a worktree-launched agent
  # CLAUDE_PROJECT_DIR may name the worktree itself.
  #
  # Attribution: every upstream gate is inert here. The command is not a `git`
  # command and its cwd is a worktree, so the git-presence short-circuit, the
  # no-drift exit and the toplevel exemption would each ALLOW it; only the
  # tracker refusal can produce a 2.
  check 2 "unresolvable cd (variable) does not bypass the tracker refusal" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd \\\"\$CLAUDE_PROJECT_DIR\\\" && pnpm tracker task create 'x'\"},\"cwd\":\"$WT_ROOT\"}"
  check 2 "unresolvable cd (command substitution) does not bypass it either" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd \\\"\$(git rev-parse --show-toplevel)\\\" && pnpm tracker doc create 'x'\"},\"cwd\":\"$WT_ROOT/packages/x\"}"
  # The RESOLVABLE spelling of the same walk-to-the-root shape, so the pair
  # shows both `cd` paths reach the check rather than only the fallthrough.
  check 2 "a resolvable relative cd to the worktree root still reaches the check" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd ../.. && pnpm tracker task create 'x'\"},\"cwd\":\"$WT_ROOT/packages/x\"}"
  # The worktree half, isolated: an unresolvable `cd` from a MAIN checkout has
  # no worktree to refuse, so probing the pre-`cd` cwd must not invent one.
  check 0 "unresolvable cd from a main-checkout cwd is not refused" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd \\\"\$X\\\" && pnpm tracker task create 'x'\"},\"cwd\":\"$WT_MAIN\"}"
  # And the drift half is unchanged: an unresolvable `cd` still allows a git
  # command outright, because the hook cannot know where it will run.
  check 0 "unresolvable cd still allows a git command (drift check unchanged)" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd \\\"\$X\\\" && git add packages/x/y.ts\"},\"cwd\":\"$WT_ROOT/packages/x\"}"

  # A backtick substitution is not a quoted span — `strip_quoted` leaves it
  # intact, so the confirming pass already saw this shape and only the raw
  # prefilter's preceding-character class was short-circuiting on the backtick.
  check 2 "tracker mutation inside a backtick substitution" \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"result=\`pnpm tracker task create x\`\"},\"cwd\":\"$WT_ROOT\"}"
fi

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
