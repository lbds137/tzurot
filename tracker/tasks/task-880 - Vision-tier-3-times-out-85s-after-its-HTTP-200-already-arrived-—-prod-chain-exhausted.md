---
id: TASK-880
title: >-
  Vision tier 3 times out 85s after its HTTP 200 already arrived — prod, chain
  exhausted
status: To Do
assignee: []
created_date: '2026-09-03 21:41'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 878000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: runtime-observed in prod 2026-09-03, requestId 18030278-987f-4b88-8023-42c022238f3b, job image-18030278-987f-4b88-8023-42c022238f3b-image. An owner image went undescribed because the vision fallback chain exhausted. Two of the three tiers are explained (content refusals, below); the THIRD is not, and it is the reason this is filed high.

The anomaly, from the pino time= fields rather than the log-line timestamps: the qwen/qwen3.5-397b-a17b tier was intercepted at time=1788471076411, the custom fetch logged Custom fetch received response status=200 ok=true contentType=application/json at time=1788471081128 (4717 ms later, a healthy response), and the invocation then failed with AbortError category=timeout at time=1788471166414 — 90003 ms after the request, i.e. exactly TIMEOUTS.VISION_MODEL (90000, packages/common-types/src/constants/timing.ts:22). So 85286 ms elapsed between a successful HTTP 200 arriving and the timeout firing. This is not a slow provider and not a network stall: the response came back in under five seconds and something after the fetch never finished consuming it.

HYPOTHESIS, code-read only, NOT runtime-confirmed — do not build on it before reproducing. PR 2299 made buildOpenRouterClientConfig attach the custom fetch to EVERY OpenRouter client, so response.clone() plus a json() parse now runs on every call rather than only on extras-bearing ones; the 2299 review flagged that widening at the time, and TASK-863 carries it as a non-blocking follow-up about log volume. A clone/consumer interaction over the response body would present exactly this way. The suggestive detail is that the SAME custom fetch completed normally on the tier immediately before (openrouter/auto, clone plus parse done inside ~5 s) — but that body was a small no-choices error object, where tier 3 would have carried a full description payload. So the shape to test is a LARGE body, not the fetch as such.

Fix shape: reproduce first, ship nothing before the observation. One diagnostic that would settle it — time the custom fetch's clone/parse separately from the caller's own body read, and log both, so the next occurrence attributes the 85 s to a specific consumer instead of to the invocation as a whole. If the clone is implicated, the options are to skip cloning when no extras are present (restoring the pre-2299 gating for the read path only), or to consume the clone without holding the original. If it is NOT the clone, the same instrumentation still narrows it to LangChain response handling, which is where to look next.

Note the timeout itself behaved correctly — 90 s fired at 90003 ms. The bug is the 85 s of nothing before it, not the timer.

Context for the other two tiers, which are NOT this bug and need no fix: z-ai/glm-5.3-flash returned a 400 naming its own content filter, and openrouter/auto returned a 200 with an error body that the 2299 surfacing correctly rendered as Gemini blocked the request: PROHIBITED_CONTENT. Both are ordinary content refusals on spicy artwork. They do raise a separate product question — the chain is deep but not diverse, three mainstream-filtered models, so for that class of image the first two will always refuse and the chain is effectively one deep. That is an owner call, not part of this task.
<!-- SECTION:DESCRIPTION:END -->

