---
id: TASK-1522
title: Vision chain has no tier that survives a z.ai capacity outage plus a burst
status: To Do
assignee: []
created_date: '2026-11-24T01:41:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-11-24 01:36 UTC all 14 images in one message got placeholders. Prod ai-worker logs show every chain as tiers=["z-ai/glm-5.4","z-ai/glm-5.3-flash","google/gemma-4-31b-it:free"], each tier failing rate_limit within about 1 s. The first two tiers share one z.ai capacity pool (code 1305 overloaded), and the free gemma floor 429s when 14 attachments hit it in parallel. The chat path recovered because its fallback went to OpenRouter glm-5.3-flash, a paid route outside the z.ai pool.

What: (1) the composed vision chain should include at least one tier outside the primary provider capacity pool, e.g. a paid OpenRouter vision route when the user has BYOK, before the free floor; (2) consider limiting per-message vision concurrency or backing off once on a capacity 429 so a burst does not exhaust the free floor; (3) check whether tiers that resolve to the same provider should count toward MAX_VISION_FALLBACK_TIERS (describeImageWithFallback.ts composeVisionTiers).

Acceptance: a z.ai capacity outage with a 10+ image message still yields descriptions for a BYOK user, pinned by a test in visionFallbackChain.test.ts.
<!-- SECTION:DESCRIPTION:END -->
