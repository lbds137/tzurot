---
id: TASK-288
title: failed_transient release DMs have no retry path (resweep gap)
status: To Do
assignee: []
created_date: '2026-07-16 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'area:jobs'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 288000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-16 (#1683 r3 observation) — `failed_transient` release DMs have no retry path: the incomplete-broadcast resweep only re-enqueues `pending` rows, so a transient Discord/network blip during a blast means that one user silently never gets the release note (the dmErrorClassifier doc's promised "future retry sweep" was never built; retention then purges the row at 90d as settled). **Fix shape**: extend the resweep to also re-enqueue `failed_transient` rows (needs a per-row attempt bound so a permanent-ish transient doesn't retry forever — e.g. flip to failed_permanent after N resweep retries), or fold into a dedicated retry pass. **Trigger technically fired 2026-07-17** (first blast: failedTransient=26) — but ALL 26 were discord-50278 (no mutual guilds — durable, not retryable; misclassification fixed via the now.md Quick Win). Zero genuinely-transient failures observed yet, so the retry pass stays parked. **Promote when**: a tally shows nonzero failedTransient that is NOT a misclassified durable code.

**Why:** Transient = retryable by definition; today it's terminal in practice, just invisibly.
<!-- SECTION:DESCRIPTION:END -->
