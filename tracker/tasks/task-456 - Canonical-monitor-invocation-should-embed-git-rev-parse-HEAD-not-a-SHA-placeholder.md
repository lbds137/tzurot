---
id: TASK-456
title: >-
  Canonical monitor invocation should embed $(git rev-parse HEAD), not a SHA
  placeholder
status: To Do
assignee: []
created_date: '2026-08-07 02:26'
updated_date: '2026-08-07 02:26'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: high
ordinal: 455000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The three surfaces show the monitor command with a SHA PLACEHOLDER (<full-40-char-sha> / $SHA), so arming a monitor requires transcribing a real SHA into it. That transcription failed FOUR times in one session on 2026-08-06: two abbreviated SHAs (which return total_count 0 and read as "keep waiting"), and two fabricated ones where the short SHA from a git commit line was completed with invented characters. All four are well-formed enough to pass a naive check and all four spin silently to the timeout.

PR 1992 added a local git cat-file existence check to gh:ci-gate, which turns a fabricated SHA into an instant error. That is a good backstop but it is still a backstop: it catches the mistake after it is made, and it only protects the ops-CLI form, not the bash form still used on branches whose base predates the gate.

The fix that removes the opportunity: make the canonical invocation on all three surfaces literally read --sha $(git rev-parse HEAD). Copying it verbatim is then correct by construction and there is nothing to transcribe. Verified working: a Monitor command with command substitution evaluates correctly at arm time.

Blocker to handle: guard:monitor-command normalizes the SHA with the regex --sha \S+, and $(git rev-parse HEAD) contains spaces, so the three copies would no longer normalize to equal strings. Fix the normalizer at the same time — since --sha is the last token on the line in every copy, normalizing --sha .*$ to a placeholder is both simpler and correct.

Acceptance: the rule, the skill, and the hook heredoc all show --sha $(git rev-parse HEAD); guard:monitor-command still passes; a monitor armed by copying the canonical line verbatim watches the right SHA.

## Riders carried from PR 1992's round-5 review (merged without them, deliberately — they touch these same three surfaces plus ci-gate.ts, so they land here rather than in a sixth CI cycle)

RIDER 1 — 05-tooling.md still claims CI is the slowest workflow at "~20 min". MEASURED 2026-08-06 across the last 7 CI runs on feat/ci-gate-command: 3-4 minutes each. The actual long pole is claude-review at 4m31s to 9m44s, trending upward with diff size. Fix the figure and name claude-review as the pole, because the stale number is what made the round-5 reviewer conclude the gate's 25-minute budget has only a 5-minute margin when the measured worst case is about 14 minutes.

RIDER 2 — fetchRuns' page-ceiling warning writes to console.warn (stderr) via its own default, while every other diagnostic in ci-gate.ts threads through the injected log (stdout). runCiGate passes `fetch: fetchRuns` as a bare reference, so the one path reporting an API result the gate structurally cannot see past is also the one least likely to surface. One-line fix: `fetch: sha => fetchRuns(sha, log)`. Add a wiring assertion so the bare-reference form cannot come back.

RIDER 3 — no test drives waitForCi's heartbeat while state is undefined, i.e. a gh api outage spanning a full HEARTBEAT_MS. describeWaitState(undefined) and the healthy-slow heartbeat are each tested alone; the scenario the gate exists to fix (a broken gate must not look like a slow one) is not. Script more than ten consecutive GhApiErrors across the heartbeat interval and assert the emitted line contains "no data (gh api failing)".
<!-- SECTION:DESCRIPTION:END -->
