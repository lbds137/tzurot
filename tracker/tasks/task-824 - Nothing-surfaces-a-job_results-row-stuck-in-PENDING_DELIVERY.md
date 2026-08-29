---
id: TASK-824
title: Nothing surfaces a job_results row stuck in PENDING_DELIVERY
status: To Do
assignee: []
created_date: '2026-08-29 18:41'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 824000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR 2253 (TASK-821) and accepted as a backlog candidate. That PR stopped the delivery path from confirming a DROPPED result, so a lost reply now honestly leaves its job_results row at PENDING_DELIVERY instead of falsely flipping it to DELIVERED. Strictly better — a silent data loss recorded as success was the bug — but it trades a WRONG invisible state for a CORRECT invisible state. Nothing sweeps, alerts on, or reports a row that has sat PENDING_DELIVERY for hours, so "the honest state" is currently honest to nobody.

Two mechanisms already known to leave such rows, both deliberate: (a) the unknown-job drop in the results-listener path, and (b) SingleJobRecovery.discard when a context cannot be rebuilt (channel gone, personality inaccessible, source message deleted, aged out). Both are correct not to confirm; neither leaves a signal anyone reads.

Second cost worth stating: the ai-worker cleanup job deletes only DELIVERED rows, so an unconfirmed row is never reclaimed at all. The leak is slow and bounded by how often delivery genuinely fails, but it is unbounded in time.

Fix shape: NEEDS GROUNDING — check first whether any existing surface already reports this (ops health, the error-channel reporter, an admin command) before building a new one; the schema has an index on (status, completedAt), which suggests a query was once intended. Candidate shapes, none chosen: a periodic count of rows PENDING_DELIVERY older than N minutes posted to the owner error channel; a field in an existing health/ops output; or a cleanup pass that reclaims them after a long grace with a logged count. Whatever is chosen should distinguish "genuinely lost" from "in flight right now" — a row is legitimately PENDING_DELIVERY for the duration of a normal generation.

Acceptance: a job whose reply was never delivered becomes visible to the operator within a bounded window, rather than resting in a state nothing reads; and the row-retention consequence is handled explicitly.

Provenance: reviewer-raised on PR 2253, filed as the accepted backlog disposition — counts against the drain net.
<!-- SECTION:DESCRIPTION:END -->
