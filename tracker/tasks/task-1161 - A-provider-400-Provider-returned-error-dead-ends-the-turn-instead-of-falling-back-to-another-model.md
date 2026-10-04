---
id: TASK-1161
title: >-
  A provider 400 (Provider returned error) dead-ends the turn instead of falling
  back to another model
status: To Do
assignee: []
created_date: '2026-10-04 16:45'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-10-04: a character reply errored with "400 Provider returned error" on qwen/qwen3.8-omni-flash via OpenRouter. Owner: "this should have fallen back to a different model rather than erroring". HYPOTHESIS (code-reading, not runtime-confirmed): text-lane fallback DOES exist (tier-aware quota fallback / retarget, services/ai-worker/src/services/quotaFallback.ts), but RETARGETABLE_CATEGORIES (quotaFallback.ts:110) deliberately excludes BAD_REQUEST ("a config bug to surface, not availability"), and apiErrorParser.ts classifies a bare HTTP 400 wrapper as BAD_REQUEST. OpenRouter wraps UPSTREAM provider failures in a 400 with the message "Provider returned error", so an availability failure of the upstream provider reads as a user config bug and is never retargeted. Precedent for the same class: commit bff9213de added the "is not a valid model ID" phrase to detectSpecialCases (services/ai-worker/src/utils/apiErrorParser.ts) as a narrow wrapped-in-400 hoist.
What: (1) get the raw error body from the prod log or diagnostics for the specimen request (a 400 whose body carries error.metadata.provider_name / raw is the upstream-provider shape) and confirm which category it landed in; (2) classify the upstream-provider-failure shape as a retargetable availability category (SERVER_ERROR-like) in detectSpecialCases, narrowly (only the OpenRouter provider-error wrapper, so genuine validation 400s such as context-window or bad parameter stay BAD_REQUEST); (3) test: specimen body -> retargetable -> one hop to the tier floor.
Related: TASK-205 (empty-response retry; its claim "no text-generation equivalent of the vision fallback chain exists" is stale since quota fallback landed - re-verify there), TASK-1088 (explicit fallbackConfigId edge), TASK-822 (retry ladder wait budget), TASK-1050 (price ceiling on the paid floor).
Acceptance: the specimen shape retargets to a fallback model and the turn answers; a genuine parameter-validation 400 still surfaces as BAD_REQUEST; both pinned by tests on the real classifier.
<!-- SECTION:DESCRIPTION:END -->
