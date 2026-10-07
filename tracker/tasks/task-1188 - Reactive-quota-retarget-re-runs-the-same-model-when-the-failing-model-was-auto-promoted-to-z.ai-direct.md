---
id: TASK-1188
title: >-
  Reactive quota retarget re-runs the same model when the failing model was
  auto-promoted to z.ai-direct
status: Done
assignee: []
created_date: '2026-10-07 15:45'
updated_date: '2026-10-07 16:52'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1178000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod 2026-10-07 15:22-15:40Z, requestId a80834be (job llm-c9a2244d), Lilith. A glm-5.3-flash turn timed out on z.ai-direct (1 x 180s), then the auto-promotion fallback ran z-ai/glm-5.3-flash on OpenRouter (3 x 180s, all AbortError), then QuotaFallback fired a reactive retarget with fromModel="glm-5.3-flash" toModel="z-ai/glm-5.3-flash" -- the SAME model on the SAME OpenRouter route that had just failed three times. Two more 180s timeouts followed before bot-client flushed a synthetic timeout at 18 min; the worker was still mid-attempt.

Root cause (code-read, matches the audit line): the same-model guard in services/ai-worker/src/services/quotaFallback.ts:384 is `config.model === failingModel`. After auto-promotion the failing model is the z.ai-direct bare id (glm-5.3-flash) while the admin global default is the OpenRouter id (z-ai/glm-5.3-flash), so the string compare misses and the retarget is a no-op in model terms. The global default config is "GLM 5.3 Flash (Reasoning: high)", z-ai/glm-5.3-flash.

What: compare on the canonical model (normalize the z.ai-direct promoted id back to its OpenRouter twin, or carry the pre-promotion configured model as failingModel), and also skip the retarget when the target was already tried by the auto-promotion fallback in this job. Sweep the proactive retarget path in AuthStep.ts (resolveRetargetRoute) for the same compare.

Acceptance: a seam test with an auto-promoted personality whose global default is the OpenRouter twin of the failing model: no retarget fires; a test that fails before the fix.
<!-- SECTION:DESCRIPTION:END -->
