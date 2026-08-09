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
<!-- SECTION:NOTES:END -->
