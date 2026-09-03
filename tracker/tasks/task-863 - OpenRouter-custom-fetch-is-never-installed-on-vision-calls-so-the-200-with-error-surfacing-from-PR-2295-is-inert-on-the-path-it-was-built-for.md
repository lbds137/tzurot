---
id: TASK-863
title: >-
  OpenRouter custom fetch is never installed on vision calls, so the
  200-with-error surfacing from PR 2295 is inert on the path it was built for
status: Done
assignee: []
created_date: '2026-09-02 03:51'
updated_date: '2026-09-03 21:42'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
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

### 2026-09-02 — code half SHIPPED (PR #2299); task is now a prod watch

buildOpenRouterClientConfig attaches the custom fetch to every OpenRouter client (the needsCustomFetch gate and the constant customFetch log field are gone; request-side injection stays gated inside the fetch on non-empty extraParams). Pinned by a vision-shape test in ModelFactory.test.ts and an empty-extraParams POST pass-through test in OpenRouterFetch.test.ts; three tests that pinned the old gating were retargeted, one of them (the exact-object match on the client config) found by the worker rather than the spec.

Watch (state:observable): (1) the first prod image after the beta.214 deploy logs Custom fetch intercepting request on its OpenRouter vision call; (2) the next openrouter/auto zero-choices failure logs the surfacing warn line with errorCode / providerName / modelSlug. If (2) does not print, the body has choices with empty content rather than no choices — add a debug capture of the raw body.

Follow-up carried from the #2299 review (non-blocking): the two Custom fetch intercepting / received response info lines and the response.clone + json parse now run on every OpenRouter call, not only extras-bearing ones. Check prod log volume after deploy; once clause (1) is observed the two info lines can drop to debug — the acceptance signal is one-time, the volume is permanent.

### 2026-09-03 — WATCH CLOSED, both clauses observed on one event

Prod, requestId 18030278-987f-4b88-8023-42c022238f3b (owner image, vision chain exhausted).

Clause (1) MET: Custom fetch intercepting request logged on the OpenRouter vision call, twice — once for the openrouter/auto tier and once for the qwen tier. The gate the fix removed is gone; the fetch is installed on a vision-shaped config with no transforms, route, verbosity or thinking.

Clause (2) MET, and it did not degrade to the empty-content branch the watch hedged for: OpenRouter returned 200 with an error body and no choices — synthesizing error status, carrying status=400 errorCode=400 errorMessage=Gemini blocked the request: PROHIBITED_CONTENT. No debug capture of the raw body is needed; the body had no choices, exactly as the fix assumed. Note the surfaced fields were errorCode and errorMessage — providerName and modelSlug did not appear on this occurrence, so the watch text naming all three was wider than what the line actually carries. Not a defect: the failure was attributable without them.

Value demonstrated rather than assumed: without this fix the tier would have surfaced as the uninformative Model returned zero choices, and the refusal would have been unattributable. It named Gemini on its first real occurrence.

The non-blocking follow-up above stays open and is now MORE than a log-volume question: the unconditional clone plus parse is the leading hypothesis for TASK-880, where a vision tier timed out 85 s after its own HTTP 200 had already arrived. Dropping the two info lines to debug should NOT happen until 880 is resolved — they are the instrument that made 880 visible at all.
<!-- SECTION:DESCRIPTION:END -->
