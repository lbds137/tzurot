---
id: TASK-751
title: Permanently-dead stored-history images re-attempt vision hourly forever
status: To Do
assignee: []
created_date: '2026-08-23 20:27'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 751000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-737 shipped the expired-URL pre-check (zero provider spend on dead URLs), but the negative cache is 60min, so a permanently-dead stored-history image still re-attempts every hour indefinitely - now free, but never-ending churn.
What: making it stop means persisting an unavailable attachmentEnrichment marker, which CONTRADICTS the deliberate invariant at services/ai-worker/src/services/prompt/storedReference.ts:88-90 that absence means never-computed (retryable). Resolving that tension is a design decision with data-model implications, not a nit.
Acceptance: owner decides between (a) persistent unavailable marker (invariant change, documented), (b) longer negative-cache TTL for expired-URL failures specifically, or (c) accept the hourly zero-cost re-attempt as fine. Then implement the chosen shape.
<!-- SECTION:DESCRIPTION:END -->
