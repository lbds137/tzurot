---
id: TASK-351
title: >-
  Multi-tag partial-batch errored delivery: debug log + shutdown-window drop
  class
status: To Do
assignee: []
created_date: '2026-07-29 11:52'
updated_date: '2026-09-04 19:36'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 351000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two non-blocking review observations on #1852. (1) The partial-batch branch fires deliverErroredOutcomes with no log line, unlike the all-failed path which logs erroredCount — a debug log with groupId/erroredCount would let ops correlate gateway write-timeouts with user-visible partial failures. (2) Fire-and-forget error deliveries (the void call in startFanOut, and the same class elsewhere in the coordinator) can be dropped silently if the process shuts down in the narrow window before they settle — harm is one missing in-character error line, rare (submit-error + shutdown coinciding). Merits reason to defer, not origin: awaiting in-flight deliveries at beginShutdown is a design change across the whole fire-and-forget class, disproportionate to the harm today.
Fix shape: add logger.debug({ groupId, erroredCount }) in the partial branch; optionally have beginShutdown await a tracked set of in-flight error-delivery promises if the class ever bites in prod logs.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed still missing — `deliverErroredOutcomes` (the partial-batch path) has no log line, while the all-failed sibling (`deliverAllFailedNotice`) does log `erroredCount`. Cheap ops-correlation fix; weak keep on its own but real diagnostic gap. Evidence: `sed -n '320,370p' services/bot-client/src/services/multiTagDeliveryFlow.ts` → `erroredCount` logged only inside `deliverAllFailedNotice`, not at the `deliverErroredOutcomes` call site used by the partial-batch branch.
---
<!-- COMMENTS:END -->
