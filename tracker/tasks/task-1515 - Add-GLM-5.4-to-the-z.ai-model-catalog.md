---
id: TASK-1515
title: Add GLM 5.4 to the z.ai model catalog
status: In Progress
assignee:
  - tzurot
created_date: '2026-11-23T06:46:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1515000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila asked 11-23 for GLM 5.4 support. z.ai added glm-5.4 to the coding-plan /models list on 2026-11-23 (created 1795406400); OpenRouter does not list it yet and docs.z.ai/guides/llm/glm-5.4 is 404.

Measured 11-23 on the coding plan (dev key): a call returns ok as model glm-5.4; a 950,016-token prompt is accepted and ~1.05M is refused (code 1261), consistent with the 1M family limit; image_url input is accepted and perceived (glm-5.3 rejects it with code 1210, glm-5.3-flash accepts), so supportsVision; thinking disabled still returned reasoning tokens.

What: ZAI_MODEL_CATALOG entry (packages/common-types/src/constants/ai.ts) with contextLength 1_000_000, released 2026-11-23, supportsVision true, thinkingOff GLM_5X_THINKING_OFF; VISION_MODEL_PATTERNS entry (services/ai-worker/src/services/modelCapabilityPatterns.ts); tests that enumerate the catalog. Defaults (ZAI_FREE_TIER_MODEL, piggyback preset) unchanged.

Acceptance: glm-5.4 resolves via zaiCodingPlanModelCapabilities with the measured values; degraded-mode vision pattern agrees; common-types and ai-worker suites green.
<!-- SECTION:DESCRIPTION:END -->
