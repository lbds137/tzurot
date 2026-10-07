---
id: TASK-1189
title: >-
  Reasoning-model detection misses GLM-5.x, so maxTokens is not scaled by the
  thinking level
status: To Do
assignee: []
created_date: '2026-10-07 15:45'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1179000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod logs on 2026-10-07 show isReasoningModel=false for glm-5.3-flash and z-ai/glm-5.3-flash, while the admin default config is "GLM 5.3 Flash (Reasoning: high)". GLM_THINKING in services/ai-worker/src/utils/reasoningModelUtils.ts:35 matches only glm-4.x.

Effect (code-read): the only behavioural consumer is getEffectiveMaxTokens in services/ai-worker/src/services/ModelFactory.ts:275, which scales maxTokens by thinking level only when the config sets no maxTokens; LLMInvoker.ts:229 just logs it. So a GLM-5 config without maxTokens gets the standard default rather than the reasoning-scaled one. Not tied to the 2026-10-07 timeout (TASK-1188).

What: extend the pattern to GLM-5.x (check which GLM-5 variants actually reason before widening), plus a unit test per new id.

Acceptance: detectReasoningModelType returns GlmThinking for glm-5.3-flash and z-ai/glm-5.3-flash, tested.
<!-- SECTION:DESCRIPTION:END -->
