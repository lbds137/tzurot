---
id: TASK-808
title: >-
  Vision path never deletes __raw_response — 200-500KB raw payload retained per
  message
status: To Do
assignee: []
created_date: '2026-08-29 01:02'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 808000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: extractAndPopulateOpenRouterReasoning has exactly one call site (LLMInvoker.ts:478, the text path). VisionProcessor.ts:315 invokes via invokeModelGuarded directly, so the extractor never runs on vision responses — and ModelFactory.ts:493 sets __includeRawResponse: true unconditionally in the OpenRouter builder. Consequence: additional_kwargs.__raw_response (a 200-500KB raw OpenRouter payload) is never deleted on the vision path, the exact retention the extractor header (extractOpenRouterReasoning.ts:25-26) says it exists to prevent. Found during the TASK-791 instrumentation slice (worker verification, 2026-08-29); deliberately kept out of that slice because the fix is behavior-adjacent (mutates the message, deletes a field).

Fix shape: call extractAndPopulateOpenRouterReasoning in the vision path after invoke (option A from the 791 slice analysis) — which also gives vision the openrouter.provider/providerError diagnostics — OR a narrower targeted delete of additional_kwargs.__raw_response if the full extractor has text-path assumptions. Verify which with a read of the extractor against a vision-shaped message first.

Acceptance: a vision response object post-processing carries no __raw_response; a test pins it; the choice between full-extractor and targeted-delete is recorded in the PR.
<!-- SECTION:DESCRIPTION:END -->
