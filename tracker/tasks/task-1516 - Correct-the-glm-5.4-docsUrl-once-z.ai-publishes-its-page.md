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

What: check docs.z.ai/llms.txt for a GLM-5.4 page; set docsUrl to the live URL; add a buildModelInfoUrl test case like the glm-5.3-flash one.

Acceptance: the catalog docsUrl for glm-5.4 returns 200.
<!-- SECTION:DESCRIPTION:END -->
