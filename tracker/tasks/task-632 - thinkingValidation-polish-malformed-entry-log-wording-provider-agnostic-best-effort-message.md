---
id: TASK-632
title: >-
  thinkingValidation polish: malformed-entry log wording + provider-agnostic
  best-effort message
status: To Do
assignee: []
created_date: '2026-08-16 20:43'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 632000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two low-severity review observations on the save-time warnings PR, routed here at the round cap. (1) OpenRouterModelCache.supportsReasoning logs "Cache unavailable" when a single malformed catalog entry (missing supported_parameters) throws inside the try — misleading diagnostics for a one-entry problem; add a ?? [] guard or reword. (2) The best-effort warning text hardcodes "GLM-5.x" though ZaiThinkingOffSupport is provider-agnostic — a future non-GLM best-effort model would be misnamed; derive the family from the model string or drop it.

Acceptance: log message distinguishes malformed-entry from cache-outage; warning text stays correct for a hypothetical non-GLM best-effort entry (pin with a test).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. both nits still open. (1) `OpenRouterModelCache` still fires the generic `'Cache unavailable for lookup'` warn on the throwing path (confirmed by its own test name), no distinct wording for a single malformed catalog entry. (2) `thinkingValidation.ts:66` still hardcodes `"best-effort on GLM-5.x models"` even though `ZaiThinkingOffSupport` is provider-agnostic. Low-severity polish, routed here at a review round cap. Evidence: `grep -n "Cache unavailable for lookup" services/api-gateway/src/services/OpenRouterModelCache.test.ts`; `grep -n "GLM-5.x" services/api-gateway/src/utils/thinkingValidation.ts`.
---
<!-- COMMENTS:END -->
