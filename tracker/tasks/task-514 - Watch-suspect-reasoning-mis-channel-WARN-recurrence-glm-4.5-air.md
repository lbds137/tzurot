---
id: TASK-514
title: 'Watch: suspect reasoning mis-channel WARN recurrence (glm-4.5-air)'
status: To Do
assignee: []
created_date: '2026-08-10 23:57'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 514000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the glm-4.5-air mis-channel (full reply in reasoning_content, throwaway fragment as content; prod requestId 479b3251, 2026-08-10) shipped as watch-only telemetry in PR #2057 because no automatic guard can act on the length signature without leaking real meta-reasoning (measured: a legit glm-5.2 row had the identical signature). Baseline: 1 genuine hit in 132 GLM requests/22h (glm-4.5-air 1/63, glm-5.2 0/64).
What: periodically (or when a user reports a truncated/fragment reply) query Railway ai-worker logs for the WARN message "Suspect reasoning mis-channel" and confirm hits against the llm_diagnostic_logs row (24h retention). The predicate is family-scoped to GLM in services/ai-worker/src/utils/reasoningMischannel.ts.
Escalation (prod-config only, no release needed): (a) disable reasoning on the GLM 4.5 Air free-default LlmConfig, or (b) point the free default at GLM 5.2. Owner call either way.
Acceptance: either the warn stays rare (~baseline) and this stays open as a watch, or recurrence triggers the owner escalation decision and this closes with the config change recorded.
<!-- SECTION:DESCRIPTION:END -->
