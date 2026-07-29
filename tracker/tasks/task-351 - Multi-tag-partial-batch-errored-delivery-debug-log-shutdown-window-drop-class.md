---
id: TASK-351
title: >-
  Multi-tag partial-batch errored delivery: debug log + shutdown-window drop
  class
status: To Do
assignee: []
created_date: '2026-07-29 11:52'
labels:
  - 'origin:review'
dependencies: []
priority: low
ordinal: 351000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two non-blocking review observations on #1852. (1) The partial-batch branch fires deliverErroredOutcomes with no log line, unlike the all-failed path which logs erroredCount — a debug log with groupId/erroredCount would let ops correlate gateway write-timeouts with user-visible partial failures. (2) Fire-and-forget error deliveries (the void call in startFanOut, and the same class elsewhere in the coordinator) can be dropped silently if the process shuts down in the narrow window before they settle — harm is one missing in-character error line, rare (submit-error + shutdown coinciding). Merits reason to defer, not origin: awaiting in-flight deliveries at beginShutdown is a design change across the whole fire-and-forget class, disproportionate to the harm today.
Fix shape: add logger.debug({ groupId, erroredCount }) in the partial branch; optionally have beginShutdown await a tracked set of in-flight error-delivery promises if the class ever bites in prod logs.
<!-- SECTION:DESCRIPTION:END -->
