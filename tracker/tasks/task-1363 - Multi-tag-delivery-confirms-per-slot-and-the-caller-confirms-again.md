---
id: TASK-1363
title: Multi-tag delivery confirms per slot and the caller confirms again
status: To Do
assignee: []
created_date: '2026-11-08T16:52:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1346000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found reviewing PR 2723 (TASK-823). The multi-tag coordinator paths call confirmDelivery per slot themselves (services/bot-client/src/services/multiTagDeliveryFlow.ts, the confirmDelivery(slot.jobId) call; services/bot-client/src/services/multiTagRecoveryHelpers.ts, the confirmDelivery(jobId) call), and the coordinator-owned branch of MessageHandler.handleJobResult returns delivered, so deliverJobResult (services/bot-client/src/services/deliverJobResult.ts) confirms the same job a second time. The confirm is an idempotent PENDING_DELIVERY to DELIVERED status flip, so the cost is one redundant gateway call per multi-tag job, not a wrong record. PR 2723 removed the same double confirm from the stale-discard and late-recovery paths, leaving deliverJobResult the single confirm site there.

What: make deliverJobResult the single confirm site for coordinator-owned jobs too, or have the coordinator branch report a disposition that tells the caller confirmation is already owned (JobResultDisposition's doc names 'owns its own delivery confirmation' as a delivered case). Check first which slots the coordinator confirms that never pass through deliverJobResult (synthetic timeouts confirm later, per the multiTagDeliveryFlow comments).

Acceptance: a multi-tag job is confirmed exactly once, pinned by a seam test running the real deliverJobResult with only confirmDelivery mocked.
<!-- SECTION:DESCRIPTION:END -->
