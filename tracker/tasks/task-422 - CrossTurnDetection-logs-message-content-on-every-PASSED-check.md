---
id: TASK-422
title: CrossTurnDetection logs message content on every PASSED check
status: Done
assignee: []
created_date: '2026-08-04 02:51'
updated_date: '2026-08-04 03:50'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 422000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod sweep 2026-08-04 — the PASSED branch of crossTurnDetection.ts logCheckOutcome logs newResponseSnippet, closestMatchSnippet, and the full comparisonReport (80-char prefixes of up to 25 history messages) at INFO on EVERY generation (~97/6h). This is message content in prod logs (00-critical No PII rule) and the largest log-line class by bytes. The docstring says the report exists to reconstruct slipped duplicates — a deliberate diagnostic, so the resolution is an owner call, not a silent strip.

Recommendation: keep comparisonReport + snippets on FAILED and NEAR_MISS only (rare, and exactly the reconstruct cases); PASSED logs the numeric fields + hashes only.

Acceptance: a PASSED check logs no message text; FAILED/NEAR_MISS retain the full report; owner has signed off on the split.
<!-- SECTION:DESCRIPTION:END -->
