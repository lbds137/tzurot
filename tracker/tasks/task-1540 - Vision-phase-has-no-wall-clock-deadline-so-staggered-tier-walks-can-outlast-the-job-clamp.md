---
id: TASK-1540
title: >-
  Vision phase has no wall-clock deadline, so staggered tier walks can outlast
  the job clamp
status: To Do
assignee: []
created_date: '2026-11-25T08:51:00Z'
updated_date: '2026-11-25T09:40:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1540000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2809 bounds per-message vision concurrency at 4 and keeps the paid floor, so a chain can be 5 tiers. The tier walk has no global timeout (ImageDescriptionJob.ts:228, no withRetry and no globalTimeoutMs on the resolver path); each tier is bounded only by TIMEOUTS.VISION_MODEL = 90s (timing.ts:22). Worst case, every tier stalls: 5 x 90s = 450s per image, and 10 images run in ceil(10/4) = 3 waves = 1350s, over MAX_JOB_RUNTIME 1200s (timing.ts:80). Before 2809 the same case was about 360s because all walks ran at once. calculateJobTimeout (timeout.ts:88) budgets images as one 273s slot whatever the count. Hypothesis: the incident failure mode was fast 429s, not stalls, so the tail is unmeasured.

What: give the vision phase a per-message deadline (for example an AbortSignal shared by the walks, with remaining images getting the placeholder when it fires), or size calculateJobTimeout by waves.

Acceptance: a test with every tier stalling shows the vision phase finishing under its budget with placeholders for the unfinished images; the job is not killed by the runtime clamp.

Related (PR 2809 review): withParallelRetry waits for a whole attempt before retrying any failed item, so with the bound at 4 an attempt takes about ceil(N/4) walk-durations and a fast-failing audio or document item waits that long before its retry. A deadline design here should cover that path too.
<!-- SECTION:DESCRIPTION:END -->
