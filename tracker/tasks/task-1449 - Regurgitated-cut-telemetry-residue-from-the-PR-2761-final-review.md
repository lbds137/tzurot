---
id: TASK-1449
title: Regurgitated-cut telemetry residue from the PR 2761 final review
status: To Do
assignee: []
created_date: '2026-11-18T01:05:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1449000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review on PR 2761 (squashed head 001c8907c, no blockers), filed at the review-round step-back. File: services/ai-worker/src/utils/responseArtifacts.ts and its test.

1. The overlap caveat says to read regurgitatedTurnEchoOverlap only when regurgitatedTurnCutTurns === 1, but an echo of ANOTHER speaker (model repeats Carol while the current user is Bob) is also one turn and scores near 0, which reads as "the cut removed text the user did not write" (the promote-a-content-guard signal), a false positive. Either state in the caveat that turns === 1 is necessary but not sufficient, or log a boolean "cut speaker is the current user" (no PII) so the signal is clean before anyone acts on it. Resolve BEFORE using the overlap to decide on a content guard.
2. regurgitatedTurnCutTurns = cutText === undefined ? 0 : countTurnHeaderLines(cutText): the field is spread only when regurgitatedTurnCutChars > 0, where cutText is always defined, so the 0 arm is never logged. A discriminated return type for cutRegurgitatedLeadingTurns (fired: { cutChars, cutText, headerStrip } vs not fired) would make the tie explicit and drop both optional-field checks.
3. No test isolates the turn counter recovering after a closed fence: [Bob] header, body, a fenced block, a real [Carol] header, text, then the self header and reply should log regurgitatedTurnCutTurns 2.

Declined from the same review: the unrelated reactions ReDoS comment reflow it flagged as churn is harmless and improves line length; nothing to do.

Acceptance: each item fixed or ruled out with its reason.
<!-- SECTION:DESCRIPTION:END -->
