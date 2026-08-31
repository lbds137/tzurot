---
id: TASK-843
title: >-
  BaseCacheInvalidationService.subscribe registers the callback before the try
  block — a failed subscribe leaves it stale
status: Done
assignee: []
created_date: '2026-08-31 16:30'
updated_date: '2026-08-31 21:27'
labels:
  - 'area:cache-invalidation'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 843000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review [info] observation on PR 2273 (verified against source at review time): BaseCacheInvalidationService.subscribe() pushes to this.callbacks BEFORE the try block (packages/cache-invalidation/src/BaseCacheInvalidationService.ts:190 at 2026-08-31), so a duplicate() throw rejects the subscribe but leaves the callback registered on an instance with subscriber === null. A caller that retries subscribe with a new callback double-registers: the stale callback also fires on every subsequent message. The PR 2273 test "propagates the original error when creating the duplicate connection fails" pins today's propagation behavior but not this state inconsistency.

Fix shape: move the callbacks.push(callback) after the successful subscriber assignment inside the try, OR remove the pushed callback in the catch before rethrowing. Extend the existing PR-2273 test to assert the callback list is empty after a failed subscribe (a resubscribe-after-failure sequence proves it end to end). One file plus its colocated test.

Acceptance: after subscribe() rejects, a later successful subscribe(cbB) delivers messages to cbB only; the failed cbA never fires; the new assertion is proven-red against the current push-before-try ordering.
<!-- SECTION:DESCRIPTION:END -->
