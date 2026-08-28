---
id: TASK-798
title: Cap max_tokens on the system-model (extraction) call path
status: To Do
assignee: []
created_date: '2026-08-28 19:18'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 798000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the vision 402 fix (TASK-791) capped one of TWO createChatModel call sites that send no max_tokens. The sibling is invokeSystemModel in services/ai-worker/src/services/systemModel/systemModelCall.ts:90 — it passes temperature and responseFormat but no maxTokens, so on the OpenRouter route it carries the same exposure: an unbounded ask can exceed the key balance and be refused with HTTP 402 ("requested up to N tokens, but can only afford M").

CORRECTION 2026-08-28, propagated from the review of the capping PR. An earlier version of this task asserted that the provider reserves the routed model the full output capacity up front. That mechanism is NOT established and should not be repeated. Against it: the 402 evidence rested on the failing calls being vision calls, but prod has fallbackTextModel AND fallbackVisionModel both set to openrouter/auto, so the routed name cannot tell a caption apart from a chat turn. Against the competing explanation (that 65536 was our own REASONING_MODEL_MAX_TOKENS.max): that needs thinking=max, and no prod llm_config exceeds high (32768), none sets an explicit max_tokens, and the other observed size (64000) matches no constant of ours. Config level only — a user-level override was not checked. Treat the mechanism as open; the case for capping does not depend on resolving it.

Why it was NOT fixed in the same change: choosing the number needs data the vision path did not. A caption is a few hundred tokens, so 2000 is obvious headroom. Extraction returns a JSON fact array whose size scales with the memory batch (consumers: FactExtractionService.ts, rosterBlurbSweep.ts), and a cap set too low truncates the JSON mid-array, which surfaces as a parse failure and silently loses extracted facts rather than as a visible error. No output cap or fact-count bound exists anywhere on that path to derive a value from.

Also note the prod 402 sweep (25005 lines, 5 deployments) found ZERO extraction 402s. All 9 were recorded at the time as VisionProcessor lines; that attribution came from the original sweep and could NOT be re-verified on 2026-08-28 with a fresh query, so do not lean on it. What IS verified from prod: extractionProvider=zai-coding and extractionModel=z-ai/glm-5.2, so prod extraction runs the z.ai-direct route rather than OpenRouter. That is the likelier reason no extraction 402 appears. The exposure is real but currently latent; it becomes live if extraction falls back to OpenRouter.

Fix shape: measure first. Query prod usage_logs for tokensOut on extraction requestType (p99 and max), set the cap at a generous multiple, and add it as AI_DEFAULTS.EXTRACTION_MAX_TOKENS beside VISION_MAX_TOKENS. Assert it at the createChatModel seam the same way VisionProcessor.test.ts does.

Acceptance: invokeSystemModel sends a bounded max_tokens derived from measured output sizes, with a seam test that reddens when the default is removed.
<!-- SECTION:DESCRIPTION:END -->
