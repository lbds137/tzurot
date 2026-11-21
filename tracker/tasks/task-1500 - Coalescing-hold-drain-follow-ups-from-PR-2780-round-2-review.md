---
id: TASK-1500
title: Coalescing hold drain follow-ups from PR 2780 round-2 review
status: To Do
assignee: []
created_date: '2026-11-21T21:56:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1500000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2780 (TASK-1499) approved with non-blocking round-2 review items in CoalescingHoldRegistry.ts and coalescingHoldability.ts.
What: (1) update releaseCycle JSDoc for immediate vs deferred-drain contract and refresh coalescingHoldability.ts module header; (2) race Promise.all(snapshot) against a cutoff promise in startBoundedPendingSaveDrain so a never-settling save does not retain the drain closure; (3) log dropped survivor/skipped counts in onError and document successor-deletion intent; (4) add direct colocated unit tests in coalescingHoldability.test.ts for buildReleaseCyclePlan, mergeLostPayloads, recordHeldTriggerInEntry, and startBoundedPendingSaveDrain; (5) preserve initial drain reason alongside mid-drain failure reason in logs and note the denied-save drain latency trade-off in DEFAULT_SAVE_DRAIN_TIMEOUT_MS JSDoc.
Acceptance: all five items landed with colocated unit tests passing and pnpm quality green.
<!-- SECTION:DESCRIPTION:END -->
