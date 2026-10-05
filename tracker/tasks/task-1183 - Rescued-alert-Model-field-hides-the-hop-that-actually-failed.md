---
id: TASK-1183
title: Rescued-alert Model field hides the hop that actually failed
status: To Do
assignee: []
created_date: '2026-10-05 19:27'
labels:
  - 'area:observability'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner alert for request ca9899b9 (prod 2026-10-05 19:20Z) read "z-ai/glm-5.3-flash -> openrouter/free" as model_not_found, which reads as glm-5.3-flash missing. The real chain was glm-5.3-flash -> qwen/qwen3.8-27b:free (proactive guest swap, z.ai headroom closed) -> 404 -> openrouter/free. composeQuotaFallbackInfo (services/ai-worker/src/jobs/handlers/pipeline/steps/quotaFallbackRunner.ts:414) overwrites fromModel with the original on purpose for the user footer, and ErrorChannelReporter.deriveDiagnosticFields (services/bot-client/src/observability/ErrorChannelReporter.ts:272) renders that.

What: carry the failing model separately (e.g. failedModel on QuotaFallbackInfo) and render the owner card as original -> failed -> served when they differ; the user footer keeps its current trace-back.

Acceptance: a proactive-then-reactive rescue renders all three ids on the owner card; a single-hop rescue renders unchanged; a seam test asserts the field crossing ai-worker -> bot-client.
<!-- SECTION:DESCRIPTION:END -->
