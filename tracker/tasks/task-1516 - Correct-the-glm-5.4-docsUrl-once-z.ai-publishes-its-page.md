---
id: TASK-1516
title: Correct the glm-5.4 docsUrl once z.ai publishes its page
status: To Do
assignee: []
created_date: '2026-11-23T14:54:00Z'
labels:
  - area:common-types
  - size:S
  - state:observable
dependencies: []
priority: low
ordinal: 1516000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the glm-5.4 ZAI_MODEL_CATALOG entry (packages/common-types/src/constants/ai.ts, TASK-1515) uses https://docs.z.ai/guides/llm/glm-5.4 by pattern, but that URL returned 404 on 2026-11-23, so the response-footer model link (buildModelInfoUrl) is dead for glm-5.4 until z.ai publishes the page. It may dock under guides/vlm/ like glm-5.3-flash.

What: check docs.z.ai/llms.txt for a GLM-5.4 page; set docsUrl to the live URL; add a buildModelInfoUrl test case like the glm-5.3-flash one. When the page lands, also reconcile the measured catalog values with the card: contextLength 1_000_000 (measured: 999,996 prompt tokens accepted at max_tokens 5, ~1.05M refused with code 1261) and supportsVision true (measured: an image_url block accepted). A documented value is what makes the cap provably safe; the catalog rounding-down argument does not cover a measured one. If the card disagrees, the card wins and the VISION_MODEL_PATTERNS mirror in services/ai-worker/src/services/modelCapabilityPatterns.ts moves with it.

Acceptance: the catalog docsUrl for glm-5.4 returns 200; contextLength and supportsVision for glm-5.4 match the published card (or the entry comment cites the card for any deliberate difference).
<!-- SECTION:DESCRIPTION:END -->
