---
id: TASK-430
title: >-
  glm-4.5-air can echo the user message as content with the real reply in
  reasoning_content
status: Done
assignee: []
created_date: '2026-08-04 16:38'
updated_date: '2026-08-04 17:10'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: high
ordinal: 430000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed in prod (2026-08-04, requestId cdf3ebce-27b3-4d4c-8cb2-3b209eb7caea, glm-4.5-air, reasoning effort medium): the provider returned content that was a byte-identical echo of the user message (324 chars) while additional_kwargs.reasoning_content (2827 chars) carried the actual in-character reply. finishReason=stop, completionTokens=682 (both texts billed). Our pipeline was faithful: thinking_extraction correctly filed reasoning_content as thinking, hasReasoningTagsInContent=false, duplicate_removal checks assistant history not the user message, so the echo sailed through and the user received their own message back as the character. Sibling of TASK-391 (same model, reasoning-only-no-answer) but strictly worse: content is non-empty so shouldRetryEmptyResponse never fires.
Fix shape: add an echo-detection retry beside shouldRetryEmptyResponse in RetryDecisionHelper (services/ai-worker/src/jobs/handlers/pipeline/steps/RetryDecisionHelper.ts:152) — normalized similarity of response.content vs the current user message above a high threshold, with substantial thinkingContent as a corroborating signal, treated exactly like the empty case (retry, then give up loudly). Requires threading the current user message to the retry decision point. Do NOT swap reasoning_content into the reply slot — on a genuine echo-plus-real-thinking case that would leak actual reasoning as the reply.
Acceptance: a synthetic echo response triggers a retry (test), and the decision on threshold/normalization is recorded in the PR.
<!-- SECTION:DESCRIPTION:END -->
