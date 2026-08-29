---
id: TASK-811
title: Text-path failure diagnostics drop routedModel — thrown Errors are untyped
status: To Do
assignee: []
created_date: '2026-08-29 02:09'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 811000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: LLMInvoker.invokeSingleAttempt throws plain Error for empty_response / provider-error-finish, so routedModel (captured in the warn log by extractResponseDiagnostics since the TASK-791 slice) never reaches the DB-persisted diagnostic record: generationFailureResult.ts:92-95 calls recordPartialLlmResponse without it, having nothing to thread. Vision has the typed-error solution already (VisionModelError.routedModel). Review flagged on the instrumentation PR; deliberate scope boundary there — the structured warn log is the prod attribution path — but the persisted record is what /inspect and admin diagnostics read for a specific failed request.

Fix shape: mirror the vision pattern — a typed error (or an error field) carrying routedModel from the two LLMInvoker throw sites, read at the RetryError boundary in generationFailureResult and threaded into recordPartialLlmResponse (the collector already accepts it — DiagnosticCollector.ts partial list carries routedModel since the slice). Seam test: a failed text generation persists routedModel in the diagnostic payload.

Acceptance: a prod-shaped empty_response text failure shows routedModel in the persisted diagnostic record; canaried test at the collector seam.
<!-- SECTION:DESCRIPTION:END -->
