---
id: TASK-539
title: >-
  api-gateway ModelCapabilityService collapses cache-unavailable into
  model-not-found
status: To Do
assignee: []
created_date: '2026-08-12 00:38'
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
<!-- SECTION:DESCRIPTION:END -->
