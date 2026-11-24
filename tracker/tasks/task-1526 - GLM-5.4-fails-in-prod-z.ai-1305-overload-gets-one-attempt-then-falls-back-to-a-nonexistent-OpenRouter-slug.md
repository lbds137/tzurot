---
id: TASK-1526
title: >-
  GLM 5.4 fails in prod: z.ai 1305 overload gets one attempt, then falls back to
  a nonexistent OpenRouter slug
status: Done
assignee: []
created_date: '2026-11-24T05:15:00Z'
updated_date: '2026-11-24T14:32:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1523000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every prod glm-5.4 request 2026-11-24 01:36-05:06Z failed (10 of 10, ai-worker logs). Auto-promotion sends openrouter z-ai/glm-5.4 to the z.ai coding plan; z.ai answers 429 code 1305 (service temporarily overloaded); because a fallback route exists, runWithAutoPromotionFallback gives z.ai only maxLlmAttempts: 1 (services/ai-worker/src/jobs/handlers/pipeline/steps/autoPromotionFallback.ts, grep "Fail fast on the primary attempt"); the OpenRouter rescue then sends z-ai/glm-5.4, which OpenRouter does not list (catalog probe 2026-11-24: newest is z-ai/glm-5.3), so it 400s "not a valid model ID". glm-5.3-flash on the same path succeeded throughout. A direct plan probe of glm-5.4 at 05:14Z returned 200, so the model is served; the 1305s look like capacity on a new model (inferred).

What: when the fallback model is not servable on OpenRouter, do not take the fail-fast single attempt; give z.ai its normal retry budget for 1305/429. Decide how "servable on OpenRouter" is known (catalog lookup vs a per-model flag in the z.ai catalog in packages/common-types/src/constants/ai.ts).

Acceptance: a glm-5.4 request whose first z.ai call returns 1305 retries on z.ai instead of calling OpenRouter z-ai/glm-5.4; a model that does exist on OpenRouter keeps today's fail-fast fallback; tests pin both.
<!-- SECTION:DESCRIPTION:END -->
