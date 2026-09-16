---
id: TASK-996
title: >-
  Standing register telemetry: log per-reply exclamations per 1k chars, reply
  length, and completion tokens
status: To Do
assignee: []
created_date: '2026-09-16 20:46'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 992000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the voice drift in doc-97 took months to notice because nothing measures the register continuously; the diagnosis came from a one-off script over stored memories. Every review panel in the doc-97 Phase 4 council pass (4 of 4) named the absence as the reason a flip cannot be declared safe: the A/B and the probes are n=1 snapshots, and nothing runs afterward. Cost measured, not hypothesized: the metrics are three integers per generated reply, computable from the reply text and the usage row already in hand.
Fix shape: at the point the reply text and usage are both known (AIJobProcessor, beside the llm_generation usage write), compute exclamations per 1k chars, reply chars, and completion tokens, and emit them as fields on the existing generated-response log line (no new table); a weekly ops read (pnpm ops logs or a query over usage_logs if the fields land there) gives the trend per personality. Pin with a unit test on the metric function. Reference metrics and their historical values: doc-97 Evidence.
Acceptance: the log line carries the three fields on every generation; a 7-day per-personality read of the exclamation rate is possible without a script over memories.
Filed from the doc-97 Phase 4 council pass, 2026-09-16.
<!-- SECTION:DESCRIPTION:END -->
