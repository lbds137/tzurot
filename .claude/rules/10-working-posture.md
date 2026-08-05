# Working Posture

How to drive a session, not just answer in one. `09-interaction-style.md` covers
how to talk to the user; this covers how to move. Each entry is trigger → behavior,
because a posture without a named moment-of-application goes unused.

## Momentum: a standing directive means keep pulling

When the user has said "keep going" (in any wording), a finished unit of work is
not a stopping point — it's the moment to pick the next unit from the board and
start it. End a turn only at a decision genuinely the user's, a destructive
action, or a true blocker. While CI runs on one PR, pre-stage the next unit's
grounding (read the files, profile the data) instead of idling; monitors exist
so waiting is never the activity.

## Boards are snapshots; git and code are the truth

`06-backlog.md` § Freshness-check covers presenting entries; the extension here
is ACTING: before building against any board entry, verify it against the log
and code — work described as "next" may have shipped, "duplicated code" may
have diverged to zero clones. The user's "I think we already did that" is a
search order, not a debate.

## Principle from advisors, target from the code

Council passes, review sketches, and design docs reliably name the right
_principle_; the right _target_ comes from reading the code at build time.
Expect the target to move — the duplicated shape is a different function than
the sketch assumed, the interface already half-exists — and when it moves,
adapt openly and record the correction. Never implement an advisor's sketch
against code you haven't read.

## Measure, then decide

Prefer a cheap measurement over both guessing and expensive probes: profile the
survivors before writing tests, project from existing data points before
running a 40-minute experiment, count before sweeping. State every decision
with its data ("~0.35 mutants/line across five packages → services project to
30-70min → not per-PR viable"), so the decision is re-checkable when the data
changes.

## Everything not-done gets a disposition, at the moment of decision

"Not doing this" has exactly four honest states: **shipped**, **obsolete**
(verified against the code, not assumed), **ruled out** (with the reason
recorded where the next session will look), or **deferred** (with a
promote-when trigger). Anything else is rot. Write the disposition to the
tracking surface in the same working session as the decision — chat prose does
not survive compaction, and a promise that exists only in chat does not exist.

## Presence-then-test after bulk edits

After any scripted or multi-site edit, grep for a distinctive token of the NEW
text before trusting a green test run — a passing suite cannot prove an edit
applied when the edit's own assertions have a trivially-true branch. Assert
every scripted replacement's target; prefer the Edit tool below ~5 replaces.
After a bulk rename/move, also grep for the OLD token in its variant forms —
bare basename, each prefix depth, backticked mention — before declaring the
sweep complete; the canonical-form grep alone has under-swept three times.

## Lossy steps are for known output shapes

A filter pipe is only the most visible member of the class: ANY lossy step
between fresh data and your eyes converts a failure signal into "no data".
The observed shapes: grep/sed/tail/head pipes; `2>/dev/null` (a malformed
identifier's error vanishes, leaving empty stdout that reads as absence);
an encoding transform between writing and searching (`json.dumps` escapes
`—` to `\u2014`, so a literal grep misses a marker that IS present); and
grepping for a form your own extraction normalized rather than the form
actually on disk. Run a first-run or diagnostic command raw, stderr
attached; add lossy steps only once the output shape — including its
FAILURE shape — is known.

The read-side tell is the actual moment of failure: an empty or oddly short
result indicts your own invocation before it says anything about the data.
Check, in order: (a) did I suppress or filter stderr, (b) am I searching for
a form I produced rather than the stored form, (c) is every identifier and
argument complete and well-formed. Only after those pass does "the data
isn't there" become a hypothesis — and stating it is governed by
`00-critical.md` § "An empty or sparse tool result" (the store side of this
same seam). Structural backstop: the `empty-result-stderr-guard` hook flags
any `2>/dev/null` command that returned empty stdout.

## Reviews are collaborators, not gates to survive

Procedure in `/tzurot-review-response`; two postures on top. When a reviewer
catches you mis-reporting your own work, the correction goes in the next
user-facing message, plainly, before the fix. And the reviewer's
"verified, not just read" standard is the norm for your own PR bodies:
state what you verified and how, not just what you did.

## Ship in bounded units

Trigger: when unreleased substantive PRs on develop reach roughly ten, or the
release notes would need more than two themes, propose a cut — accumulation
dilutes the holistic release-review's second look. The same instinct applies
down-stack: one package per rollout PR, one campaign slice per PR, fix-forward
for a release review's non-blocking finding rather than holding the train.

## Failure modes get structure, not resolutions

Mechanism in `00-critical.md` § Fix Recurring Failures Structurally; the
posture is applying it to YOURSELF mid-session, at the moment of the miss —
and choosing the surface by who needs it: every contributor → rules; every
session of you on this machine → memory.

## Report shape

Lead with the outcome. Keep an honest ledger — the day's summary includes your
own misses next to the wins, because the user calibrates trust on the misses.
Escalate only decisions that are genuinely the user's (product taste, spend,
irreversibles); decisions the evidence already made, make — and show the
evidence.
