---
id: TASK-1172
title: >-
  Vision fallback-chain specimen pins a message shape the OpenAI SDK never
  produces
status: To Do
assignee: []
created_date: '2026-10-04 22:27'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1161 found that a real OpenRouter-wrapped Alibaba refusal arrives as message "400 Provider returned error" with data_inspection_failed only in error.error.metadata.raw. The vision specimen in services/ai-worker/src/services/multimodal/visionFallbackChain.test.ts (scenario 4, ~line 337-360) builds the error with the code inlined in the MESSAGE and runs under a parseApiError mock that matches a message substring, so it never exercised the real classifier on the real shape; that is how the text-path misclassification shipped unseen (the parser test of the same fixture shape was green too). Code-reading (OpenRouterFetch.ts synthesizeErrorStatus re-emits the body verbatim) suggests the vision path gets the same envelope shape, so vision refusals were likely BAD_REQUEST in prod until the TASK-1161 fix; not runtime-confirmed.
What: rebuild scenario 4 with the SDK envelope (message 400 Provider returned error, error.metadata.raw carrying the Alibaba body) and let the real parseApiError classify it, mocking only the model client boundary.
Acceptance: scenario 4 goes red if the metadata.raw scan in apiErrorParser.detectSpecialCases is removed.
<!-- SECTION:DESCRIPTION:END -->
