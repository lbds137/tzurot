# PR Monitoring — gate reasoning and fire-time procedure

The arming constraints live in `.claude/rules/05-tooling.md` § PR Monitoring
(slimmed to the arming rules); this page holds the reasoning behind them AND
the fire-time procedure, for whoever is handling a fired monitor or changing
the invocation or the gate (`packages/tooling/src/gh/ci-gate.ts`, behaviour
pinned by `ci-gate.test.ts`).

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
promptly still matters. Omitting `--sha` watches the PR's current head instead,
so no drift check is needed (the SHA is the head); the canonical command above
is unchanged. An EMPTY `--sha` is refused rather than defaulted: it means the
caller's substitution misfired. Omitting it right after a push gives up the
"the commit I just pushed" guarantee: GitHub may not have indexed the push yet,
so the gate can watch the previous head. Use the explicit form right after a push.

## Waiting

A `sleep` and a hand-written poll loop were both measured emitting a premature
`CI_COMPLETE`; the gate waits for the `CI` run to complete and for nothing else
on that SHA to be in flight before handing off to `gh pr checks --watch`. It
also asserts that a `Claude Code Review` run exists for the SHA and has
completed — a run that has not been created yet is invisible to the in-flight
check, so inferring quiescence from its absence released the gate before the
review had posted; if none appears within `REVIEW_RUN_GRACE_MS` of CI
settling, the gate prints `CI_GATE_REVIEW_MISSING` and exits non-zero.

## When the monitor fires — the four steps

All four must happen — do not stop after step 1 even if every check passed:

1. Note the final CI state from `gh pr checks N`, **and run the SHA-pinned
   run-list query in § Outcomes below**. Numbers and enumerations in the PR
   body and the commit body are re-derived against the head REF
   (`git grep <pat> HEAD`, `git show HEAD:<path>`), never the working tree.
2. Fetch new reviewer feedback from all **three** endpoints
   (`gh api /issues/N/comments` does not cover them together):
   - `pnpm ops gh:pr-comments N` — conversation + inline line-level review
     comments (where human reviewers leave blocking feedback)
   - `pnpm ops gh:pr-reviews N` — review summaries (Approve / Request Changes /
     Comment)
   - `pnpm ops gh:pr-info N` — PR-level state

   Track the last reported comment's timestamp so a later push doesn't
   re-report it, and **include human reviewers** alongside the bots.
   **claude-review health**: a green check means the action _completed_, not
   that a body was posted — if no new `claude[bot]` comment exists after a
   green run, `gh run rerun <run-id>` before proceeding.

3. In one concise message, report CI pass/fail **and** any new review findings
   (blocking vs. non-blocking); if there are no new reviews, say so. **Read
   every `###` section of each review body — do not rely on the trailing
   Summary** — and every `claude[bot]` entry when there are several.

4. **Apply review feedback — invoke `/tzurot-review-response` first, before
   touching anything.**

If CI fails or CodeQL flags a new alert, surface it via `PushNotification`.

## Outcomes — read WHICH sentinel printed

Only the first means CI finished:

- `CI_COMPLETE` — CI finished, nothing else was in flight, and the review run
  completed → proceed to the review fetch
- `CI_GATE_TIMEOUT` — the gate gave up at 25 min → re-arm; do NOT assume CI
  passed
- `CI_GATE_STARTUP_FAILURE` — a run died before dispatch (invisible in
  `gh pr checks`) → `gh run rerun <run-id>`, then re-arm
- `CI_GATE_REVIEW_MISSING` — CI finished but no `Claude Code Review` run
  existed for the SHA within the 5-min grace → re-query the run list; if it is
  still absent the workflow never dispatched, so `gh run rerun` has nothing to
  rerun and a re-push is not a reliable lever — check its `on:` filter against
  the PR event
- _none of them_ — the Monitor's own 30-min `timeout_ms` killed the process →
  re-arm

**A green `gh pr checks` list is not proof CI ran.** A run that dies before
dispatch (`startup_failure`) creates zero check-runs, so it is absent from the
list while the surviving workflows print green. Confirm the run list for the
head SHA:

```bash
gh api "repos/{owner}/{repo}/actions/runs?head_sha=$(git rev-parse HEAD)" \
  --jq '.workflow_runs[] | "\(.status) \(.conclusion // "-") \(.name)"'
```

Don't substitute a client-side filter over `gh run list` (`head_sha` filters
server-side, so the result is exhaustive). **An empty result minutes after a
push means "not indexed yet"**: re-query before concluding anything. Anything
not `completed success` (or `skipped`) is a finding; **pin on the SHA, never a
timestamp window**.

**A red check with zero steps never ran — that's infrastructure, not your
diff**, and is rerun-eligible per `00-critical.md`'s failure-shape table.
`gh pr checks` renders it like a real failure, so read the step count when a
job fails without an obvious cause:

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run-id>/jobs?per_page=100" \
  --jq '.jobs[] | "\(.conclusion // "-") steps=\(.steps | length) \(.name)"'
```

**Wait on the gate, never on a `sleep` or a hand-written poll loop** — both
were measured emitting a premature `CI_COMPLETE`.

**"Monitor script failed (exit 1)" can be cosmetic**: the final
`gh pr checks` exits non-zero whenever ANY check is red, and `fixup-check` is
intentionally red on a fixup-bearing branch until autosquash — read the event
stream for the outcome.

## The review-round count

After the sentinel, the gate counts claude-review cycles on the PR. From ≥1
cycle it prints `📋 REVIEW ROUNDS ARE DISPATCH WORK` — the trigger for
`/tzurot-review-response` § 3a: batch the round's findings into ONE worker
dispatch. At ≥6 it also prints `⚠️ REVIEW_ROUND_CAP` — the trigger for § 5a:
stop iterating in this context and hand the open findings to a fresh-context
implementer or the owner. An `unavailable` line means the count did not run,
not that the PR is under the cap.

The count is advisory and fail-open. One known inflation: a PR editing the
claude workflow files still creates a review-workflow run per push while the
action self-skips, so a workflow-sync PR can trip `REVIEW_ROUND_CAP` on push
churn rather than real rounds.

## Re-surfaced comments after a restart

The last-reported-comment timestamp lives in conversation state, so after a
session restart a re-fetch may re-surface already-reported comments once —
expected, not a dedup bug.

## Merge mechanics

When a merge follows a verification run in the same turn (a re-fetched check
list, a review re-read), chain them with `&&` so a failed check halts before
the destructive step. When the target branch moved under a long-lived feature
branch, re-derive diffstats and counts against the MERGE-BASE, not the
target's current HEAD.
