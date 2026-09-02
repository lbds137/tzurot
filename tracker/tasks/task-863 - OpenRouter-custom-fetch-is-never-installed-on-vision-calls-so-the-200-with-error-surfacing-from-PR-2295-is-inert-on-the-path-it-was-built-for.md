---
id: TASK-863
title: >-
  OpenRouter custom fetch is never installed on vision calls, so the
  200-with-error surfacing from PR 2295 is inert on the path it was built for
status: To Do
assignee: []
created_date: '2026-09-02 03:51'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 863000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: runtime-observed in prod 2026-09-02 03:14:59Z, the first image re-walk after the beta.213 deploy. The openrouter/auto tier still failed through invokeModelGuarded (Model returned zero choices), the new warn line (OpenRouter returned 200 with an error body and no choices) never printed, and no Custom fetch intercepting line exists for that call. Cause, read at ModelFactory.ts ~L441-445: needsCustomFetch = hasExtraParams || hasReasoning, where extraParams come only from modelConfig.transforms / route / verbosity (buildOpenRouterExtraParams, ~L311) and reasoning needs modelConfig.thinking. A vision call (VisionProcessor.ts ~L253) passes none of those, so createOpenRouterFetch is not attached and neither the 200-with-error surfacing nor the older 400-content recovery runs for vision.

The chain itself worked: the third tier qwen/qwen3.5-397b-a17b responded at 03:15:32Z (TASK-791 chain-end clause met). What is still unknown is WHY openrouter/auto answers with zero choices for images, because the instrument that would tell us is not wired in.

Fix shape: install the OpenRouter custom fetch unconditionally for the OpenRouter provider (needsCustomFetch = true; keep the extraParams injection gated on hasExtraParams inside the fetch, which it already is). The per-request JSON parse cost the #2295 review noted then applies to every OpenRouter call, which was already accepted for the callers that had it. Add a test in ModelFactory.test.ts pinning that a vision-shaped config (no transforms, no route, no verbosity, no thinking) gets the custom fetch. Then watch prod for the warn line on the next openrouter/auto vision failure; if it still does not print, the body has choices with empty content (the empty-content guard) rather than no choices, and the raw body needs a debug capture.

Acceptance: a vision call to OpenRouter logs Custom fetch intercepting request; the next zero-choices auto failure logs the surfacing warn line with errorCode / providerName / modelSlug, or the debug capture shows the actual body shape.
<!-- SECTION:DESCRIPTION:END -->
