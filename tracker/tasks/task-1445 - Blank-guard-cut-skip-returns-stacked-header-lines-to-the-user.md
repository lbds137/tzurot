---
id: TASK-1445
title: Blank-guard cut skip returns stacked header lines to the user
status: To Do
assignee: []
created_date: '2026-11-17T22:10:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1445000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2761 review (round 2, item 4). When the regurgitated-turn cut is skipped by the blank guard (regurgitatedTurnCutSkipped: blank), the reply keeps the echoed turn and its stacked header lines, so the user sees raw headers such as [Lila - t] / [Bob - t] (pinned as current behaviour by the F3 case in services/ai-worker/src/utils/responseArtifacts.test.ts). That was the pre-cut behaviour, but header-only remainders now classify as blank, so the skip path fires more often.

What: decide what the skip path should return when the remainder after the self header is blank: strip the trailing stacked header lines, or keep the echoed body and drop only header lines. Measure first: count regurgitatedTurnCutSkipped=blank lines in prod logs after #2761 ships.

Acceptance: a skipped cut never returns a reply that ends in raw header lines; F3 updated deliberately with the chosen shape; a test pins it.
<!-- SECTION:DESCRIPTION:END -->
