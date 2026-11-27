---
id: TASK-1571
title: >-
  errorInfo.userMessage + synthetic technicalMessage literals write-only on some
  paths
status: To Do
assignee: []
created_date: '2026-11-27T09:19:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1561000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2825 round-3 review finding 2 — bot-client synthetic-error paths populate errorInfo.userMessage and a literal technicalMessage that nothing reads or logs (buildErrorContent renders category + ref only; deliverErrorNoPersist logs nothing; reportJobError reads the category alone; MessageHandler logging covers real job results only).
What: decide removal vs a real consumer for both fields on the synthetic paths — a cross-service schema-contract change (common-types errorInfo schema plus both producers), needs its own PR.
Acceptance: either the fields are removed from the synthetic paths with the contract swept, or a consumer exists and the comments name it.
Promote when: next touch of the errorInfo schema or bot-client error delivery.
<!-- SECTION:DESCRIPTION:END -->
