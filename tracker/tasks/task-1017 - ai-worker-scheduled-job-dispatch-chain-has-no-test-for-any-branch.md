---
id: TASK-1017
title: ai-worker scheduled-job dispatch chain has no test for any branch
status: Done
assignee: []
created_date: '2026-09-18 16:24'
updated_date: '2026-09-21 16:26'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1013000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the if-chain in services/ai-worker/src/index.ts setupScheduledJobs that maps SCHEDULED_JOBS names to their sweep functions (pending memories, cleanup, roster blurbs, digest sweep, digest retention, release reconcile) is untested for every branch — a renamed constant or a dropped branch would register a job that silently returns null on every tick. Surfaced by claude-review on PR 2451 as pre-existing; the class is every branch, not the one that PR added.
Fix shape: extract the name-to-handler map into a small pure module (a Record keyed by SCHEDULED_JOBS values) with a colocated test asserting every SCHEDULED_JOBS key has a handler and each handler is the expected function; index.ts dispatches through the map.
Acceptance: a test fails when a SCHEDULED_JOBS entry has no handler or when a handler is swapped; index.ts no longer carries the if-chain.
<!-- SECTION:DESCRIPTION:END -->
