---
id: TASK-1348
title: >-
  System-model calls hand partial content to the parser on an error
  finish_reason
status: To Do
assignee: []
created_date: '2026-11-03T21:12:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1331000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: LLMInvoker treats finish_reason === error as a retryable failure (services/ai-worker/src/services/LLMInvoker.ts:552, FINISH_REASONS.ERROR), because OpenRouter reports mid-generation upstream failures inside an HTTP 200 with partial content. invokeSystemModel (services/ai-worker/src/services/systemModel/systemModelCall.ts, grep resolveFinishReason) reads the same finish reason since PR #2715 but checks it only against LENGTH. On the OpenRouter route an extraction call ending in error therefore hands partial JSON to the parser, which surfaces as a parse failure and silently loses facts. Latent today: prod extraction runs z.ai-direct; live if extraction falls back to OpenRouter. Raised by claude-review round 3 on PR #2715.

What: decide the shape. Throwing retryable like LLMInvoker interacts with the extraction busy/retry path and budget consume/refund (04-discord.md Spend-Idempotent Retries: a failed call that spent tokens must not be refunded as zero-spend, and partial completion must not re-bill), plus archive-summary and recent-days-digest callers. A warn-only first step is cheaper but leaves the facts lost.

Acceptance: an error finish_reason on any invokeSystemModel caller is either retried with spend-idempotent semantics or recorded as a failed call with its usage row, never parsed as a successful response; a test per path pins it.
<!-- SECTION:DESCRIPTION:END -->
