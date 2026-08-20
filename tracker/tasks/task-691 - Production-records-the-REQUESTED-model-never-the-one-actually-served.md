---
id: TASK-691
title: 'Production records the REQUESTED model, never the one actually served'
status: To Do
assignee: []
created_date: '2026-08-20 01:22'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 691000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: this is the observability gap that let the z.ai reroute hide. TASK-687 proved by probe that a glm-4.5-air request is served as glm-4.7, and #2153 moved the carve-out onto the served name. But nothing in production would have surfaced that, and nothing would surface the next one either.

The mechanism: LLMInvoker modelName is an INPUT, so diagnostics modelUsed echoes what we asked for. The served name arrives only in the raw response, and __includeRawResponse is deliberately OFF on the z.ai path (services/ai-worker/src/services/ModelFactory.ts:544) because extractAndPopulateOpenRouterReasoning runs unconditionally (LLMInvoker.ts:477) and is written for the OpenRouter response shape. So the model echo is discarded before anything can read it.

Consequence: every usage row, every /admin usage aggregate, and every diagnostic attributes spend to a name the provider may have silently reinterpreted. The owner z.ai chart disagreeing with our own numbers was the only signal that anything was wrong, and it took a hand-run probe to settle.

Blocked on: TASK-611, which asks to gate the __raw_response check on the effective provider. That is the same boundary — enabling __includeRawResponse on the z.ai path without gating the extractor feeds z.ai responses to an OpenRouter-shaped reader. Do 611 first, then this becomes small.

Fix shape: once the extractor is provider-gated, enable __includeRawResponse on the z.ai path, read the response model field, and record it alongside the requested name (they are usually equal, so store the served name and let equality be the common case rather than adding a nullable divergence flag). Then a reroute is visible in /admin usage instead of requiring a probe.

Acceptance: a z.ai-direct generation records the model the provider reports serving, distinct from the requested name when they differ, and /admin usage attributes spend to the served model.
<!-- SECTION:DESCRIPTION:END -->
