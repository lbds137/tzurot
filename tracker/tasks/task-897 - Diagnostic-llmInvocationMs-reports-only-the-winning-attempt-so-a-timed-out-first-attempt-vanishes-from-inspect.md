---
id: TASK-897
title: >-
  Diagnostic llmInvocationMs reports only the winning attempt, so a timed-out
  first attempt vanishes from /inspect
status: To Do
assignee: []
created_date: '2026-09-05 06:56'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 895000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: DiagnosticCollector resets its LLM timer on every retry (resetLlmTimingForRetry, called from duplicateRetry and reached via the auto-promotion fallback), so llmInvocationMs is the duration of the attempt that succeeded and nothing else. A prod request on 2026-09-05 spent 180 s in a direct z.ai attempt that aborted at LLM_PER_ATTEMPT (AbortError, 1 attempt), then 36 s in the OpenRouter fallback; /inspect showed llmInvocationMs 36 s inside a 242 s total, and the owner read it as three unexplained minutes. The prod logs (AutoPromotionFallback line for request 5c64ca75) were the only place the first attempt existed.
Fix shape: keep a per-attempt ledger in the collector instead of resetting: attempts [{ provider, model, upstreamProvider when known, durationMs, outcome: ok | aborted | error, errorName }]. timing gains llmAttemptCount and llmTotalMs (sum over attempts) beside llmInvocationMs (the winning attempt, unchanged so existing readers keep working). /inspect renders attempt count and total when they differ from the winning attempt. The invoker is non-streaming (no stream option in LLMInvoker or modelInvocation), so first-token versus mid-stream stalls are indistinguishable and out of scope.
Owner call recorded 2026-09-05: the 180 s per-attempt timeout stays. A second request the same night answered on the direct z.ai path in 129 s with no fallback, which a 60 to 90 s first-attempt budget would have cut off. A circuit breaker on consecutive direct-path timeouts is a separate idea, not filed.
Acceptance: a diagnostic for a request whose first attempt aborted shows both attempts with their durations and outcomes and a total that matches the logged processingTimeMs within the non-LLM steps; existing single-attempt diagnostics are unchanged; the collector test pins the ledger across a reset.
<!-- SECTION:DESCRIPTION:END -->
