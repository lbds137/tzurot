---
id: TASK-609
title: >-
  GLM-5.3 reportedly removes reasoning-off; our effort:none level may become
  invalid
status: Done
assignee: []
created_date: '2026-08-14 16:07'
updated_date: '2026-08-16 23:07'
labels:
  - 'area:ai-worker'
  - 'area:common-types'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 609000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GLM-5.3 shipped 2026-08-14. Press coverage reports two API-surface changes that touch us: three thinking effort levels (low, high, max) and thinking can NO LONGER be disabled, described as a breaking change for callers that previously ran with thinking off.

Our exposure: REASONING_EFFORT_LEVELS in packages/common-types/src/schemas/llmAdvancedParams.ts is xhigh, high, medium, low, minimal, none — where none is documented as 0 percent, reasoning disabled. Personas currently run z-ai/glm-5. If the report holds, an LlmConfig setting effort none against a GLM-5.3 model is a combination the provider will reject or silently ignore. Our level names also do not line up with the reported low/high/max trio.

VERIFICATION STATUS: unverified. This comes from launch coverage, not from a probe. GLM-5.3 was NOT listed on OpenRouter at filing time (only glm-5, glm-5.1, glm-5.2), and we route through OpenRouter, so nothing is broken today and no action is warranted yet.

Promote when: GLM-5.3 appears in the OpenRouter model catalog. At that point run the cheapest falsifying probe — a single call with reasoning effort none — and prefer its result over the coverage. Related: the GLM-family reasoning-tag vocabulary churn already tracked for the Chain-of-Extractors strips.

Acceptance: either the report is falsified by probe and this is archived with that evidence, or effort none is blocked/remapped for GLM-5.3-class models with a test pinning the behaviour.
<!-- SECTION:DESCRIPTION:END -->
