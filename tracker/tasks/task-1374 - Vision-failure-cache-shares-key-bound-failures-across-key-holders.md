---
id: TASK-1374
title: Vision failure cache shares key-bound failures across key holders
status: To Do
assignee: []
created_date: '2026-11-09T18:23:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1357000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the vision negative cache keys on (model, attachment) only (services/ai-worker/src/services/VisionDescriptionCache.ts, grep getFailureKey). A key-bound failure (AUTHENTICATION, QUOTA_EXCEEDED, CREDIT_EXHAUSTION, FREE_TIER_QUOTA, RATE_LIMIT) describes the key that ran, not the image, yet it is stored for everyone: one user's own-key 429 or revoked key makes other users skip that model on that image for the TTL, and a shared-plan 429 makes an own-key user skip theirs. Applies to every user key; PR 2732 (own-plan glm-5.3-flash) adds flash to the population. Found by claude-review on PR 2732; deferred there because the fix is wider than that PR.

What (fix shape, grounded by two worker stop reports): (1) runVisionTier in describeImageWithFallback.ts never threads config.source into describeOptions.loggingContext.apiKeySource, so describeImage sees 'system' (ImageDescriptionJob hardcodes it) or undefined on user-key tiers; thread it per tier. (2) Store side, VisionProcessor.ts model-failure storeFailure: skip key-bound categories when apiKeySource is user. (3) Read side, checkNegativeCache in visionDescribeGates.ts (already receives apiKeySource, only logs it): ignore key-bound entries for a user-key attempt. (4) Existing assertions that encode the old behavior change: VisionProcessor.test.ts 'should return user-key-specific message when apiKeySource is user' (cached authentication honored on a user-key attempt; PLACEHOLDER_AUTH_USER used only there), and describeImageWithFallback.integration.test.ts tier-1 user-key 429 asserting tierOneFailure stored. Spec: docs/local/dispatch/task-783-round4b-spec.md step 1 (local).

Acceptance: a user-key key-bound failure is never stored; a cached key-bound entry is ignored for a user-key attempt and honored for a system-key attempt; attachment-bound categories unchanged; a real-chain seam test proves an own-key flash 429 does not store.
<!-- SECTION:DESCRIPTION:END -->
