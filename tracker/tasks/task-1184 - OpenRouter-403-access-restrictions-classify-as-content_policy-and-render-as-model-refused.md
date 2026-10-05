---
id: TASK-1184
title: >-
  OpenRouter 403 access restrictions classify as content_policy and render as
  model refused
status: To Do
assignee: []
created_date: '2026-10-05 19:41'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1174000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod 2026-10-05 19:39Z (job llm-3f5f5e14), thinkingmachines/inkling:free returned 403 "is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps". HTTP_STATUS_TO_CATEGORY maps every 403 to CONTENT_POLICY (packages/common-types/src/constants/error.ts:305), so the footer read "(model refused)" and the owner concluded the model was censoring a benign prompt. It was an access gate, not a refusal.

What: hoist the access-restriction wording (agentic harnesses, and any similar OpenRouter availability 403) in detectSpecialCases (services/ai-worker/src/utils/apiErrorParser.ts) to a category that reads as unavailable (MODEL_NOT_FOUND or a new access category), so the retarget still fires and the footer stops calling it a refusal.

Acceptance: the logged 403 body classifies as non-content-policy; a real content-policy 403 still classifies as CONTENT_POLICY; footer wording for the access case does not say refused.
<!-- SECTION:DESCRIPTION:END -->
