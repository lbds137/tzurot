---
id: TASK-702
title: >-
  RESTRICTED_PARAM_MODELS still keyed to retired glm-4.5-air - glm-4.7 params
  pass unfiltered on OpenRouter route
status: Done
assignee: []
created_date: '2026-08-20 16:17'
updated_date: '2026-09-25 00:43'
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

PROBE RESULT 2026-09-24 (the probe the owner's 2026-09-13 ruling ordered; 27 calls of max_tokens 16 each, trivial cost): NOTHING REJECTS.
- z-ai/glm-4.7, provider pinned to Z.AI with fallbacks off: a control call plus one call for each of the 8 params in GLM_45_AIR_OPENROUTER_UNSUPPORTED_PARAMS (frequency_penalty, presence_penalty, repetition_penalty, seed, top_k, min_p, top_a, logit_bias). All 9 returned HTTP 200, served by Z.AI.
- z-ai/glm-4.5-air, same 9 calls, provider pinned: all 9 returned HTTP 200 from Z.AI.
- z-ai/glm-4.5-air, same 9 calls, open routing: all 9 returned HTTP 200 (OpenRouter chose Z.AI).
So the owner's widen-condition (a 1210 on glm-4.7) did not fire, and nothing is widened. The code-1210 rejection that the glm-4.5-air entry encodes no longer reproduces on either model, so the entry now strips sampling params that the upstream accepts.
Follow-through, per the acceptance line (the denylist matches the models that actually reject, which is now none): remove the glm-4.5-air entry. If that leaves RESTRICTED_PARAM_MODELS and its filtering path empty, remove them too, together with their tests, since an empty denylist mechanism is dead code and git keeps it. Cloud-eligible: no secret is needed now that the probe is done.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: owner-ruling
created: 2026-09-13
---
Owner ruling 2026-09-13: run the paid probe (one OpenRouter call to z-ai/glm-4.7 with frequency_penalty set). Record the result here; widen the pattern to the z-ai namespace only if it 400s with code 1210.
---
<!-- COMMENTS:END -->
