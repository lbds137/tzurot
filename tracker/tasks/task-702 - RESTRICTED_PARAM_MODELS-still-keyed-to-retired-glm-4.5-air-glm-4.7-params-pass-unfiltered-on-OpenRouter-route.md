---
id: TASK-702
title: >-
  RESTRICTED_PARAM_MODELS still keyed to retired glm-4.5-air - glm-4.7 params
  pass unfiltered on OpenRouter route
status: To Do
assignee: []
created_date: '2026-08-20 16:17'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 702000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-08-20 pre-release second-look of #2153. ModelFactory RESTRICTED_PARAM_MODELS matches /glm-4\.5-air/i and strips the sampling params Z.AI 400s on (code 1210). The piggyback preset now names z-ai/glm-4.7, which matches no pattern - so on the OpenRouter route (user with an OpenRouter key, no z.ai key) those params pass through unfiltered. Whether Z.AI-via-OpenRouter rejects the same set for glm-4.7 is an unverified external-system fact. Evidence: services/ai-worker/src/services/ModelFactory.ts:121-157.

Fix shape: probe first (one OpenRouter call to z-ai/glm-4.7 with frequency_penalty set); if it 400s with 1210, broaden the pattern to the z-ai/ namespace rather than one model id; if it succeeds, record that and drop nothing.

Acceptance: the probe result is recorded here; the denylist matches the models that actually reject, pinned by a test on the pattern.
<!-- SECTION:DESCRIPTION:END -->
