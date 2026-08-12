---
id: TASK-539
title: >-
  api-gateway ModelCapabilityService collapses cache-unavailable into
  model-not-found
status: Done
assignee: []
created_date: '2026-08-12 00:38'
updated_date: '2026-08-12 03:26'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 539000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/api-gateway/src/services/ModelCapabilityService.ts resolve() has the same three-way collapse that PR 2068 fixed in ai-worker: getModelById returning null covers BOTH "the OpenRouter cache is unavailable" and "the model is genuinely not on OpenRouter", and both fall through to the z.ai catalog and then to null. Surfaced by the PR 2068 review.

UNVERIFIED PREMISE, resolve this first: the reviewer characterized the api-gateway direction as intentionally fail-CLOSED and therefore safe, and the method docstring does document the collapse. That characterization was NOT traced. This service feeds save-time capability gating, so the question is what a null actually does at the gate — if a null causes the contextWindowTokens cap check to be SKIPPED, that is fail-OPEN and the same shape of bug as the one just fixed, not the safe inverse. Trace the null through modelValidation.ts computeContextCap and the config save routes before deciding anything.

What: answer that question. If it is genuinely fail-closed, close this on merit with the trace recorded. If it is fail-open, apply the tagged-lookup shape from ModelCapabilityChecker.ts.

Acceptance: the behaviour of a cache-unavailable null at the save-time gate is stated with the code path that proves it.

## Premise resolved — fail-CLOSED, so the ai-worker fix does NOT port

Traced end to end. OpenRouterModelCache.getModelById (services/api-gateway/src/services/OpenRouterModelCache.ts:199-211) does collapse the two cases exactly as suspected: the catch returns null on cache-unavailable, and find-undefined returns null on genuinely-absent. Identical shape to the ai-worker bug.

The CONSUMER is what differs, and it inverts the outcome:

- Save-time cap gate — services/api-gateway/src/utils/modelValidation.ts:115. A null REJECTS the save outright ("not found in the available models list"). The contextWindowTokens check is never reached because the request never gets that far. Fail-closed, over-strict, not the fail-open shape TASK-449 fixed.
- Vision gate — ModelCapabilityService.supportsVision uses `?? false`. Fail-closed.
- enrichWithModelContext (modelValidation.ts:221-229) — a null returns early and the dashboard simply shows no cap. Display-only, not a gate.

So the reviewer's characterization was correct on the outcome. No capability regression to fix, and no tagged-lookup port is warranted here: tagging would let the gate distinguish the cases, but both cases already land on the safe side.

## Two residual findings from the trace (the actual work)

1. FALSE DOCSTRING. modelValidation.ts:67-69 states the OpenRouter path "Gracefully degrades: if the cache is unavailable (e.g., OpenRouter is down), validation is skipped and the request proceeds." The code does the OPPOSITE — an unavailable cache yields null and REJECTS. Only `modelCache === undefined` (never wired) skips. This is the 02-code-standards "comment that asserts behavior is a claim" class, and it asserts the reassuring direction, which is how it survived.

2. MISDIAGNOSING ERROR DURING AN OUTAGE. Because the two cases collapse, an OpenRouter outage rejects every save of a perfectly valid model with "Model 'x' not found in the available models list. Use the model autocomplete to select a valid model, or check if the model ID is correct." — sending the user to hunt a typo that does not exist. Distinguishing unavailable-from-absent at this one call site buys an honest message ("can't reach the model catalog right now, try again shortly") without changing which saves are allowed.

Neither is a correctness or security defect; both are user-facing-honesty defects. Item 2 changes a user-visible string, so it is the owner's call to take or leave.
<!-- SECTION:DESCRIPTION:END -->
