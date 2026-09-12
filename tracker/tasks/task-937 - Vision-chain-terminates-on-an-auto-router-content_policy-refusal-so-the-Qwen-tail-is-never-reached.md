---
id: TASK-937
title: >-
  Vision chain terminates on an auto-router content_policy refusal, so the Qwen
  tail is never reached
status: To Do
assignee: []
created_date: '2026-09-12 03:35'
updated_date: '2026-09-12 05:37'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: high
ordinal: 935000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-09-12 (sensitive images still get no description). Log-verified on the current prod ai-worker deployment (about 11.7 h of logs): 67 vision invocations, 51 on z-ai/glm-5.3-flash, 16 on openrouter/auto, ZERO on the qwen/qwen3.5-397b-a17b tail. Two sensitive images at 02:54Z walked glm-flash -> provider_content_refused (advance) -> openrouter/auto -> content_policy -> the loop logged Vision terminate category, image itself rejected, not retrying other tiers; both were negative-cached and two re-asks at 03:00Z and 03:04Z terminated again without any call. Mechanism: VISION_TERMINATE_CATEGORIES (services/ai-worker/src/services/multimodal/visionDescribeGates.ts:72-76) holds CONTENT_POLICY, so a router or provider policy refusal is treated as image-intrinsic; only the z.ai and Alibaba phrasings map to the advancing provider_content_refused (apiErrorParser.ts:135-139). TASK-747 recorded the contrary evidence: lower tiers do describe images an upstream filter refused.
Fix shape (owner ruling 2026-09-12, widened the same day on the owner question "what is the difference between content policy and censored, should both fall through"): VISION_TERMINATE_CATEGORIES shrinks to MEDIA_NOT_FOUND only. content_policy is a provider or router refusing the request (403-shaped policy, safety-filter, moderation, blocked wording); censored is the model answering with its output filtered (the refusal marker in a returned response); both mean this provider would not describe the image and another may, so both advance. Only a missing media URL fails identically on every tier. Keep the per-model negative cache so re-asks skip only the refusing tiers; update the terminate-set doc comment, the subset-invariant test (the excluded members become MODEL_NOT_FOUND, PROVIDER_CONTENT_REFUSED, CONTENT_POLICY and CENSORED) and the fallback-loop matrix (content_policy or censored on a non-terminal tier reaches the next tier; on the last tier the chain exhausts as before, with the terminate placeholder wording still used for those categories). Acceptance: unit tests walk glm refusal -> auto content_policy -> qwen invoked, and the same with censored; the invariant test names the four excluded members; a prod log line after deploy shows a qwen invocation following an openrouter/auto content_policy advance. Follow-on: TASK-899 (a less-filtered tail) stays separate.
Status 2026-09-12: the fix MERGED as PR 2399 (develop 3abdc6ad6); the first two acceptance clauses are met by unit tests (single-hop advances for both categories, the three-hop prod walk) and a real-Redis test where a cached content_policy entry advances to a fresh tier-2 call. Relabelled state:observable: the remaining clause is the prod log line after the beta.223 deploy, which also removes the board entry. Close on that observation.
<!-- SECTION:DESCRIPTION:END -->
