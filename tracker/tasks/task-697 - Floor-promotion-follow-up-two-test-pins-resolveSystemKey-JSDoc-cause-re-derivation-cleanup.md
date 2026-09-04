---
id: TASK-697
title: >-
  Floor-promotion follow-up: two test pins, resolveSystemKey JSDoc, cause
  re-derivation cleanup
status: To Do
assignee: []
created_date: '2026-08-20 04:52'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 697000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2155 round-5 review, four non-blocking items deferred at the round cap (the fix merged with its core scenarios pinned; these harden the edges). One small PR sweeps all four.

1. Test: the no-admin-default-at-all success arm - buildDeps({}) (both free/global null) + a non-CREDIT_EXHAUSTION category should still floor-promote and answer; currently only the same-model dead-end reaches the success branch, so the JSDoc claim "fires on ANY null tiered target" is unpinned for that arm (claims rule, 02-code-standards).

2. Test: the z.ai-guest floor-promotion path with freeTierQuota wired - assert tryConsume fires, and an over-quota verdict rethrows the original instead of a free ride. Newly-reachable path into meterForcedFallback zaiGuestDegrade (previously dead-ended before the fix); meter itself unmodified and covered at its own tests, so correct-by-construction today.

3. Doc: QuotaFallbackDeps.resolveSystemKey JSDoc still describes only the forced-entity-swap use; the guest non-OpenRouter credential arm in resolveRetryCredentials is its second consumer now.

4. Cleanup: the floor-unavailable cause log re-derives the floor (getFreeTextFloor/getSystemSetting) in the runner, duplicating selectFloorTarget one call above - have selectFloorTarget return a null-reason instead so the two sites cannot drift.

Acceptance: both tests land and canary red on the obvious mutations; the JSDoc names both consumers; the runner no longer re-derives the floor for logging.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. at least item 3 (JSDoc) confirmed still stale — `resolveSystemKey`'s JSDoc still describes only the forced-entity-swap use, even though `resolveRetryCredentials`'s guest non-OpenRouter arm is a second caller. Did not exhaustively re-verify items 1/2/4 (new test pins, floor-cause re-derivation) in this pass but found no evidence they landed either. Evidence: `sed -n '50,59p' services/ai-worker/src/jobs/handlers/pipeline/steps/quotaFallbackRunner.ts` → JSDoc on `resolveSystemKey` still says "for the forced-entity-swap path (credit-exhausted BYOK)" only; `grep -n resolveSystemKey` same file → also called at lines 454/460 inside `resolveRetryCredentials`, unmentioned in the doc.
---
<!-- COMMENTS:END -->
