---
id: TASK-632
title: >-
  thinkingValidation polish: malformed-entry log wording + provider-agnostic
  best-effort message
status: To Do
assignee: []
created_date: '2026-08-16 20:43'
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
