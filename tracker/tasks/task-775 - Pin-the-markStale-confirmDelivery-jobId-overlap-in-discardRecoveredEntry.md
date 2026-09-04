---
id: TASK-775
title: Pin the markStale/confirmDelivery jobId overlap in discardRecoveredEntry
status: To Do
assignee: []
created_date: '2026-08-26 12:55'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 775000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: discardRecoveredEntry carries a doc comment stating that pendingJobIds (from the persisted snapshot status) and deliveredJobIds (from the runtime-reconciled marker) are deliberately NOT disjoint, and names the reported-incident shape as the overlapping case: a slot still pending on disk because the crash beat the status write, which the marker pass then found already delivered. That jobId gets both markStale and confirmDelivery.

The path does run in CI (the all-delivered recovery test uses pending-on-disk fixtures with isSlotDelivered true), but no assertion pins that BOTH calls fire for the SAME jobId. The dedicated discardRecoveredEntry unit tests use a fixture whose delivered slot is already completed on disk, which sidesteps the overlap.

Fix shape: in multiTagRecoveryHelpers.test.ts, build a discard fixture with one slot whose snapshot status is pending AND whose jobId is in deliveredJobIds; assert markStale was called with that jobId, confirmDelivery was called with that jobId, and the discard completed without throwing. Canary by removing the jobId from one of the two lists.

Acceptance: the documented overlap is pinned by an assertion, so a future change that made the two lists disjoint would fail rather than silently change discard semantics.

Origin: PR #2228 round-7 review, non-blocking coverage nit. Deferred because the PR had reached the 6-round review cap and the underlying safety is independently established (both operations are idempotent and best-effort).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed still a coverage gap — the existing test's own comment states the two slots deliberately differ so it "could not show that stale-marking and delivery-confirmation select DIFFERENT slots," i.e. it sidesteps exactly the overlap case the task wants pinned. Evidence: `sed -n '648,725p' services/bot-client/src/services/multiTagRecoveryHelpers.test.ts` → `buildSnapshot()` uses distinct jobIds (`job-delivered` completed, `job-pending` pending) with no fixture where one jobId is both pending-on-disk and in `deliveredJobIds`.
---
<!-- COMMENTS:END -->
