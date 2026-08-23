---
id: TASK-750
title: Add xhigh to ThinkingLevel - the one z.ai effort level we do not expose
status: To Do
assignee: []
created_date: '2026-08-23 18:49'
updated_date: '2026-08-23 18:50'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 750000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner wish (2026-08-23) - the medium-to-high jump on GLM 5.x crosses most of that generation dynamic range in one step (live probe: 5.3 reasoning chars low/med/high/max = 129/233/403/451; 4.7 thinks ~13x more at the same level, so per-model tuning wants every available step).
What: THINKING_LEVELS (packages/common-types/src/schemas/llmAdvancedParams.ts:74) is already [off, minimal, low, medium, high, max]; the z.ai coding endpoint accepts none, minimal, low, medium, high, xhigh, max (probed live 2026-08-23 - the endpoint 400s with the full accepted list on an invalid value). Gap is exactly one level: add xhigh between high and max. Translation table: services/ai-worker/src/services/modelFactory/thinkingTranslation.ts (z.ai passes the level verbatim as reasoning_effort - xhigh works as-is; OpenRouter sends reasoning.effort and its accepted vocabulary for xhigh is UNVERIFIED - probe at build time, clamp to high if rejected).
Acceptance: xhigh selectable wherever thinking levels surface; z.ai route passes it verbatim; OpenRouter route passes or clamps per its probed vocabulary; thinkingTranslation.test.ts pins both wire shapes.
<!-- SECTION:DESCRIPTION:END -->
