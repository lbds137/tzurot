---
id: TASK-1544
title: parallelRetry tests leak fake timers; tier-count wording; constant name
status: To Do
assignee: []
created_date: '2026-11-25T15:25:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1542000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2809 review round 6, findings 3-5 (nits).

What: (1) services/ai-worker/src/utils/parallelRetry.test.ts calls vi.useFakeTimers in beforeEach but never vi.useRealTimers in afterEach, so fake timers leak into later describes; add it. (2) State the max vision tier count in one sentence (non-guest at most cap + 2: floor + concrete terminal; guest at most cap + 2: floor + hoist) in the MAX_VISION_FALLBACK_TIERS / composeVisionTiers JSDoc and model-selection-pipeline.md. (3) Consider renaming VISION_ATTACHMENT_CONCURRENCY (services/ai-worker/src/services/multimodal/constants.ts) since on processAttachments it bounds audio and documents too.

Acceptance: afterEach restores real timers; one sentence states the bound; rename done or declined with a reason.
<!-- SECTION:DESCRIPTION:END -->
