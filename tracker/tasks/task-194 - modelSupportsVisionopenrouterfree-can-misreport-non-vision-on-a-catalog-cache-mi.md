---
id: TASK-194
title: >-
  modelSupportsVision('openrouter/free') can misreport non-vision on a catalog
  cache-miss
status: Done
assignee: []
created_date: '2026-06-30 00:00'
updated_date: '2026-07-29 13:46'
labels:
  - 'area:redis'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 194000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`modelSupportsVision('openrouter/free')` can misreport non-vision on a catalog cache-miss

**Why:** `MODEL_DEFAULTS.VISION_FALLBACK_FREE` is now `openrouter/free`. `ModelCapabilityChecker` resolves vision capability from the Redis-cached OpenRouter catalog, falling back to substring `VISION_MODEL_PATTERNS` (`ModelCapabilityChecker.ts:214-238`) on a cache miss — and `openrouter/free` matches no pattern (no `gemini`/`gemma`/`qwen` substring). So if the router lacks its own catalog row AND the cache misses, `modelSupportsVision` returns `false`. **Not a bug today**: `selectVisionModel` (`VisionProcessor.ts:526-533`) assigns the free vision fallback DIRECTLY, without gating on capability. **Fix shape**: special-case `openrouter/free` as vision-capable in `ModelCapabilityChecker` (or add a router entry to `VISION_MODEL_PATTERNS`) so a direct query can't misreport it. **Promote when**: any code path starts gating the free vision fallback on `modelSupportsVision`/`hasVisionSupport`, or a guest image request fails a capability check. Surfaced 2026-06-30 by PR #1412 review (non-blocking).
<!-- SECTION:DESCRIPTION:END -->
