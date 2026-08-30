---
id: TASK-833
title: >-
  Generation failure re-parses the error, minting a second reference ID that
  never matches the logged one
status: To Do
assignee: []
created_date: '2026-08-30 18:35'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 833000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the reference ID a user is shown after a failed generation can differ from the one recorded upstream, which defeats the whole point of a support reference (correlating the user report to a log line).

Verified at source:
- services/ai-worker/src/utils/apiErrorParser.ts:554 — parseApiError calls generateErrorReferenceId() on EVERY invocation. The ID is minted per-parse, not per-error.
- services/ai-worker/src/services/LLMInvoker.ts:368, :425, :463 — the invoker parses the error and logs against that info.
- services/ai-worker/src/jobs/handlers/pipeline/steps/generationFailureResult.ts:83 — composeGenerationFailureResult then parses the SAME propagated error a second time (withFallbackFailure(parseApiError(underlyingError), error)), discarding whatever the invoker already computed and minting a fresh reference ID.

The second ID is the one that reaches the user: generationFailureResult.ts:99-105 records it into the diagnostic collector, and it surfaces in the /inspect embed Reference field.

The codebase already has the right pattern and this site does not use it: services/ai-worker/src/services/quotaFallback.ts:184, :198 and :486 all read unwrapped.info when the error is already an ApiError and only fall back to parseApiError otherwise. That is exactly the preserve-if-present shape this site needs.

NOT YET RUNTIME-CONFIRMED: the double-parse path is established by reading the call sites; I have not observed two differing reference IDs for one failure in logs. Before building the fix, get that observation — it is one log query against a real generation failure, and it also tells you which of the two IDs currently reaches the user.

Fix shape: at generationFailureResult.ts:83, reuse the already-computed ApiErrorInfo when the propagated error carries one (the quotaFallback instanceof ApiError check), and only parse when it does not. Keep withFallbackFailure layered on top either way.

Provenance: surfaced during the PR 2259 review round and claimed in chat as filed under TASK-832. It was never actually filed — no such task existed and 832 was later assigned to unrelated work. The claim reached chat only, never a PR body or any tracked file.

Acceptance: one failure produces ONE reference ID across the invoker log line and the user-visible Reference field; a test pins that an error already carrying ApiErrorInfo round-trips its reference ID through composeGenerationFailureResult instead of being re-minted.
<!-- SECTION:DESCRIPTION:END -->
