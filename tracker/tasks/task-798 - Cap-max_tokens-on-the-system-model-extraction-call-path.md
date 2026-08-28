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
Why: the vision 402 fix (TASK-791) capped one of TWO createChatModel call sites that send no max_tokens. The sibling is invokeSystemModel in services/ai-worker/src/services/systemModel/systemModelCall.ts:90 — it passes temperature and responseFormat but no maxTokens, so on the OpenRouter route it carries the same exposure: the provider appears to reserve the routed model the full output capacity up front and refuses with HTTP 402 when the key headroom is smaller than the reservation.

Why it was NOT fixed in the same change: choosing the number needs data the vision path did not. A caption is a few hundred tokens, so 2000 is obvious headroom. Extraction returns a JSON fact array whose size scales with the memory batch (consumers: FactExtractionService.ts, rosterBlurbSweep.ts), and a cap set too low truncates the JSON mid-array, which surfaces as a parse failure and silently loses extracted facts rather than as a visible error. No output cap or fact-count bound exists anywhere on that path to derive a value from.

Also note the prod 402 sweep (25005 lines, 5 deployments) found ZERO extraction 402s — all 9 were VisionProcessor. That is consistent with prod extraction running on the z.ai-direct route (extractionProvider=zai-coding), which does not exhibit the reservation behavior. So the exposure is real but currently latent; it becomes live if extraction falls back to OpenRouter.

Fix shape: measure first. Query prod usage_logs for tokensOut on extraction requestType (p99 and max), set the cap at a generous multiple, and add it as AI_DEFAULTS.EXTRACTION_MAX_TOKENS beside VISION_MAX_TOKENS. Assert it at the createChatModel seam the same way VisionProcessor.test.ts does.

Acceptance: invokeSystemModel sends a bounded max_tokens derived from measured output sizes, with a seam test that reddens when the default is removed.
<!-- SECTION:DESCRIPTION:END -->
