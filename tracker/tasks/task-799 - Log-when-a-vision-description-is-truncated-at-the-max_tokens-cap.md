---
id: TASK-799
title: Log when a vision description is truncated at the max_tokens cap
status: To Do
assignee: []
created_date: '2026-08-28 20:41'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 799000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: VISION_MAX_TOKENS bounds the captioning ask, but nothing downstream inspects the response finish reason, so a description cut off at the cap is stored and reused looking exactly like a complete one. Descriptions feed memory and search, so a truncated one degrades retrieval quietly. Review of the capping PR raised this: the cap converts a loud failure (an HTTP 402 refusal) into a graceful one, and without a signal a future long-tail truncation becomes a second silent-failure class discovered the same way the first was, by prod log archaeology.

Evidence the tail is real: 161 image descriptions stored in prod before any cap existed run median ~1998 chars, p90 ~3540, p99 ~10302, longest 15803. The 4000-token cap (~16000 chars) covers all 161, but the distribution has a long right tail and prompts are admin-configurable via the system_prompts table, so a future description CAN reach it.

What: in invokeVisionModel (services/ai-worker/src/services/multimodal/VisionProcessor.ts), read the finish/stop reason off the LangChain response and log a warn when it indicates a length stop, with modelName and the description length. Verify first what the finish reason is actually called on the response object for both the OpenRouter and the z.ai-direct route — do not assume a field name; the two routes may differ.

Second reason this matters, from the same review: the 4000 cap was sized from a sample of NON-reasoning output. VisionTierParams deliberately carries no thinking param, but the vision fallback resolves to openrouter/auto in prod (verified in system_settings), and if auto ever routes a caption to a reasoning-capable model its thinking tokens would count against the same 4000 budget as the visible description. Whether auto does that is unknown and unprobed. This logging is the thing that would actually surface it, rather than another round of prod log archaeology.

Acceptance: a captioning call that stops on length emits one warn line naming the model and length, with a test that pins the log fires for a length stop and does not fire for a normal stop.
<!-- SECTION:DESCRIPTION:END -->
