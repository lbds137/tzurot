---
id: TASK-747
title: >-
  Vision fallback tier 3 crashes on a TypeError and content-filter refusals are
  treated as transient
status: Done
assignee: []
created_date: '2026-08-23 14:17'
updated_date: '2026-08-23 17:04'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 747000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-08-23 (requestId 7da570d8, Dr. Gregory House, recovery-diary channel) - two consecutive days of fresh photos got the "could not be processed" placeholder. Log-verified chain for attachment 1541087583575081113 (14:12:10-15 UTC): tier 1 qwen/qwen3.7-plus -> 400 data_inspection_failed ("Input image data may contain inappropriate content", provider_name Alibaba) - a CONTENT refusal that recurs for every medical-recovery photo in this diary, yet logged errorType=transient shouldRetry=true; tier 2 openrouter/free -> 429 upstream (genuinely transient); tier 3 openrouter/auto -> OUR crash: TypeError "Cannot read properties of undefined (reading message)" at langchain chat_models.js:84 inside ChatOpenAI.invoke, reached via describeImageWithFallback.walkFallbackChain -> VisionProcessor.invokeVisionModel (VisionProcessor.js:157). The last-resort tier died on a bug, not a provider answer, so the chain reported failure without ever getting a real tier-3 attempt.

Fix shape, two parts: (1) find why invoke saw an undefined-message error object on the openrouter/auto route (probe the real request shape; possibly an unexpected error/stream shape from the auto router that langchain 1.2.8 mishandles) and guard our invoke path so a malformed provider error surfaces as a classified failure instead of a TypeError - tier 3 must be able to actually run; (2) classify data_inspection_failed (and provider content-refusal shapes generally) as content_refused, non-retryable for the SAME image on the SAME provider - skip immediately to the next tier and do not log it as transient. Consider whether the default vision chain should lead with a non-inspecting provider for NSFW-capable channels, but that is a config/product call to surface, not part of this fix.

Same-request adjacent, already tracked: the day-163 embed thumbnail 404 in extended context is TASK-737 (expired/deleted CDN URLs reach the vision fetch).

Acceptance: a forced malformed-error probe on the tier-3 route yields a classified vision failure (not a TypeError) and the chain still walks; data_inspection_failed maps to a content-refusal category with no same-tier retry, pinned by unit tests on the classifier; the fallback-chain test matrix gains a content-refusal + crash-tier case.

LOG-SWEEP ADDENDUM (six prod deployments, Aug 14-23): data_inspection_failed is a steady qwen background rate (19/20/4/4/5 hits per window, all qwen/qwen3.7-plus) silently absorbed by openrouter/free or openrouter/auto every time until this incident - lower tiers DO describe qwen-refused images, so the refusal is provider-specific, NOT image-intrinsic. Design consequence: the new content-refusal category must ADVANCE the chain (not join VISION_TERMINATE_CATEGORIES), long-TTL negative-cache per model+attachment. Crash mechanism pinned: @langchain/core 1.2.8 chat_models.js:84 invoke() indexes .generations[0][0].message and the auto route returned 200 with zero choices; same latent exposure at LLMInvoker.ts:470 and systemModelCall.ts:97 - fix the class with a shared empty-generations guard. Owner lever surfaced separately: per-personality visionModel on a non-Alibaba tier-1 if first-try diary descriptions matter.
<!-- SECTION:DESCRIPTION:END -->
