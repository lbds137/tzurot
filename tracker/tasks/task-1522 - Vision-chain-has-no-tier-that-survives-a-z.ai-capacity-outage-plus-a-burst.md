---
id: TASK-1522
title: Vision chain has no tier that survives a z.ai capacity outage plus a burst
status: To Do
assignee: []
created_date: '2026-11-24T01:41:00Z'
updated_date: '2026-11-25T02:41:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-11-24 01:36 UTC all 14 images in one message got placeholders. Prod ai-worker logs show every chain as tiers=["z-ai/glm-5.4","z-ai/glm-5.3-flash","google/gemma-4-31b-it:free"], each tier failing rate_limit within about 1 s. The first two tiers share one z.ai capacity pool (code 1305 overloaded), and the free gemma floor 429s when 14 attachments hit it in parallel. The chat path recovered because its fallback went to OpenRouter glm-5.3-flash, a paid route outside the z.ai pool.

What: (1) the composed vision chain should include at least one tier outside the primary provider capacity pool, e.g. a paid OpenRouter vision route when the user has BYOK, before the free floor; (2) consider limiting per-message vision concurrency or backing off once on a capacity 429 so a burst does not exhaust the free floor; (3) check whether tiers that resolve to the same provider should count toward MAX_VISION_FALLBACK_TIERS (describeImageWithFallback.ts composeVisionTiers).

Acceptance: a z.ai capacity outage with a 10+ image message still yields descriptions for a BYOK user, pinned by a test in visionFallbackChain.test.ts.

Recurrence 2026-11-24/25, read by lane B from prod ai-worker logs (`railway logs --filter vision`; not re-read by A): "Vision fallback chain exhausted" ×33 on deploy d2365964 (11-24 19:47Z ×9, 20:00Z ×3, 21:28Z ×11, 21:58Z ×4, 11-25 00:39Z ×5, 01:15Z ×1), plus ×38 on deploy 8e5f7612 (01:36Z ×14, 01:56Z ×24). Same tiers every time, lastAttempt category rate_limit, all three tiers failing within about 1 s, in per-minute bursts (B infers multi-image messages from the timing; this is not attributed per message). Raised medium → high: user-visible placeholders recur daily.
<!-- SECTION:DESCRIPTION:END -->
