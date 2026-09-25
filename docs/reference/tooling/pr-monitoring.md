# PR Monitoring — why the gate invocation is shaped the way it is

The constraints live in `.claude/rules/05-tooling.md` § PR Monitoring. This page
holds the reasoning behind them, for whoever needs to change the invocation or
the gate (`packages/tooling/src/gh/ci-gate.ts`, behaviour pinned by
`ci-gate.test.ts`).

## The `-C "$(git rev-parse --show-toplevel)"` root anchor

The Monitor runs in a subprocess whose cwd is not guaranteed to be the
checkout, and a bare `pnpm ops` from a subdirectory exits 254 with
`Command "ops" not found`. `git rev-parse --show-toplevel` resolves from any
subdirectory of the checkout that holds the branch — including a worktree,
where it returns the WORKTREE root, not the main checkout.

## Why the SHA is a substitution, never a pasted value

A hand-completed SHA passes any format check, so the gate refuses one that
names no local commit (`git cat-file`) rather than watching it. The
substitution removes the transcription step entirely.

The substitution resolves when the Monitor executes, not when you pushed. Two
things change what it resolves to:

- a branch hop in that checkout between the push and the arm (filing a tracker
  task between pushes is the usual one);
- a shell whose cwd is a different checkout than the worktree holding the
  branch — the substitution runs in the persistent shell cwd, so a
  worktree-held branch armed from the repo root resolves the main checkout's
  `HEAD`.

Either value still names a real local commit, so the `git cat-file` check
passes. The gate then reads the PR's head SHA from GitHub and refuses a
`--sha` that is not it, printing both, so the cost is a re-arm rather than a
mis-watch. That head read is fail-open — when GitHub cannot be read the gate
arms anyway and prints that the drift check did not run — which is why arming
promptly still matters.

## Waiting

A `sleep` and a hand-written poll loop were both measured emitting a premature
`CI_COMPLETE`; the gate waits for the `CI` run to complete and for nothing else
on that SHA to be in flight before handing off to `gh pr checks --watch`. It
also asserts that a `Claude Code Review` run exists for the SHA and has
completed — a run that has not been created yet is invisible to the in-flight
check, so inferring quiescence from its absence released the gate before the
review had posted; if none appears within `REVIEW_RUN_GRACE_MS` of CI
settling, the gate prints `CI_GATE_REVIEW_MISSING` and exits non-zero.

## The review-round count

The count is advisory and fail-open. One known inflation: a PR editing the
claude workflow files still creates a review-workflow run per push while the
action self-skips, so a workflow-sync PR can trip `REVIEW_ROUND_CAP` on push
churn rather than real rounds.

## Re-surfaced comments after a restart

The last-reported-comment timestamp lives in conversation state, so after a
session restart a re-fetch may re-surface already-reported comments once.
