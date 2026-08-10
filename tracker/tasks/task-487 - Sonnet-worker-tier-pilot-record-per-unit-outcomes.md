---
id: TASK-487
title: Sonnet worker-tier pilot - record per-unit outcomes
status: To Do
assignee: []
created_date: '2026-08-09 15:55'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 487000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the orchestration skill authorizes model: sonnet on mechanical-class worker units as a measured pilot; without a recording surface the pilot produces no evidence trail (review finding on PR 2027).
What: after each Sonnet-tier unit, append to this task notes: unit name, diff-review findings count, CI cycles to green, verdict (clean / defects).
Acceptance: after ~5 units, decide keep / expand / revert-to-Opus from the tally; then close with the decision recorded.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Unit 1 (2026-08-09): apply the approved economy-pass cut list (~60 precise edits, 3 rules files; PR #2028). Model-side defects in diff review: 0 — all cuts applied exactly, overlapping-cut spans merged correctly, one content flag raised (the barrel-removal claim) that turned out pre-verified by the orchestrator but was the RIGHT caution to raise, and the worker correctly recovered its branch after an orchestrator-caused working-tree collision (orchestrator error, not worker; asterisk on this unit's conditions — same-tree spawn, since banned by the skill's worktree mandate). CI cycles to green: pending (PR in flight at record time). Provisional verdict: clean.

Unit 2 (2026-08-10, PR #2038, TASK-500 prerelease-flag guard, 13-file cross-service diff): diff-review defects: 1 comment-level (test fixture comment described its own array order backwards); 0 semantic. Worker correctly flagged 3 deviations incl. a mandatory import ripple the spec's file list missed. CI cycles: 2 (round-2 fixes were REVIEW findings on orchestrator-approved semantics, not worker defects). Verdict: clean.

Unit 3 (2026-08-10, PR #2039, TASK-491 webhook chunking): diff-review defects: 0; worker mutation-proofed its own chunking assertion unprompted and removed a dead lint suppression it had first added. CI cycles: 3 (rounds driven by reviewer polish on orchestrator-written fixups — incl. an orchestrator-introduced cognitive-complexity trip — not worker defects). Verdict: clean.

Unit 4 (2026-08-10, PR #2040, TASK-435 fixture dedupe, incl. a RESUME for the 4-site sweep the review found missing): diff-review defects: 0 across both stretches; per-consumer reconciliation notes accurate (reviewer independently verified every claim); resume-with-context worked exactly as the skill predicts (no re-grounding cost). The missed 4 copies were an ENUMERATION failure upstream of the worker (task file + grounding agent + orchestrator acceptance grep all scoped to the known 3). CI cycles: 3. Verdict: clean.

Tally at 4 units: 0 semantic defects, 1 comment-level, all review rounds attributable to reviewer polish or orchestrator-side scoping — the Sonnet tier is holding for mechanical-class units. One more unit to the ~5 the acceptance asks for.
<!-- SECTION:NOTES:END -->
