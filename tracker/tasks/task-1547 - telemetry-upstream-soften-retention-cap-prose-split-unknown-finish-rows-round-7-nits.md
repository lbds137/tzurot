---
id: TASK-1547
title: >-
  telemetry:upstream: soften retention-cap prose, split unknown finish rows,
  round-7 nits
status: In Progress
assignee:
  - tzurot-b
created_date: '2026-11-25T17:52:00Z'
updated_date: '2026-11-27T17:31:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1543000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2810 claude-review round 7 (merged past the review-round cap) left seven non-blocking items. Item 1 is a runtime claim in the report output that overstates: CleanupDiagnosticLogs runs hourly (scheduledJobSchedule.ts 0 * * * *), so rows outlive 168 h by up to an hour, or much longer if ai-worker is down, and a --days 8 run can return them.

What (packages/tooling/src/telemetry/):
1. upstream-report-render.ts SCOPE_NOTE + renderWindowLine: replace "retention caps the data" / "cannot widen the window" with "normally pruned after N days".
2. Rows with no recorded response get finishReason unknown (getDefaultLlmResponse) and land in the other column beside odd provider reasons; split an unknown bucket or state it in SCOPE_NOTE.
3. upstream-report.ts telemetryUpstreamReport: { ...options, defaultDays: options.defaultDays ?? DIAGNOSTIC_RETENTION_DAYS } so an explicit undefined cannot fall through to parseDays 30.
4. ORDER BY model, requests DESC, upstream (deterministic tiebreak).
5. SCOPE_NOTE as a bullet list.
6. Name the 30-day default in reportRunner.ts parseDays and reuse it for the two { default: 30 } options in commands/telemetry.ts.
7. common-types diagnostics.test.ts: drop the Math.ceil(HOURS / 24) assertion that restates the code; keep toBe(7).

Acceptance: tooling + common-types tests green; a test pins the unknown bucket or the SCOPE_NOTE sentence, and the explicit-undefined defaultDays case.
<!-- SECTION:DESCRIPTION:END -->
