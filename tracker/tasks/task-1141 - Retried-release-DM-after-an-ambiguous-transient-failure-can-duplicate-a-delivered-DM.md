---
id: TASK-1141
title: >-
  Retried release DM after an ambiguous transient failure can duplicate a
  delivered DM
status: To Do
assignee: []
created_date: '2026-09-27 23:06'
updated_date: '2026-09-27 23:14'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1133 retries failed_transient release rows. A transient failure that actually delivered (e.g. a timeout after Discord accepted the DM) is re-sent on retry: at-least-once, the same model the incomplete-broadcast resweep already documents, now extended to failed_transient. Surfaced by the TASK-1133 orchestrator; not observed at runtime.

What: check whether the retry's previous-DM resolution (the heal path's standing-DM handling, which deletes a user's previous release DM before sending the replacement) already removes such a duplicate; if not, decide whether a duplicate DM is acceptable (owner-visible) or needs an idempotency check (e.g. look for our own recent DM in the channel before re-sending).

Acceptance: the behavior is documented in docs/reference/features/release-notifications.md with a test pinning it, or fixed.
<!-- SECTION:DESCRIPTION:END -->
