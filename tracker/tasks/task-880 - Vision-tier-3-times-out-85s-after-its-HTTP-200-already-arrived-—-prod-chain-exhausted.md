---
id: TASK-880
title: >-
  Vision tier 3 times out 85s after its HTTP 200 already arrived — prod, chain
  exhausted
status: To Do
assignee: []
created_date: '2026-09-03 21:41'
updated_date: '2026-09-04 10:04'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
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

GROUNDING 2026-09-04, before any code. Two findings.

1. THE CLONE HYPOTHESIS IS FALSIFIED FOR THE LOCAL CASE. A standalone Node 24.11.1 probe mirrored the custom fetch's exact order — fetch, response.clone(), await clone.json(), then the caller's own await response.json() — against a local HTTP server returning a chat-completions-shaped JSON body at 50 KB, 500 KB, 2 MB and 8 MB. Worst case (8 MB): clone.json 48 ms, orig.json 15 ms, both lengths intact. Clone-then-parse of a large body is not an 85 s mechanism on this runtime. What the prod log actually proves is narrower than the description above says: the Custom fetch received response line fires when the HEADERS arrive (it reads response.status and response.headers, nothing from the body), so 4717 ms is headers-to-request, and the body is a separate event nothing logs.

2. THE CODE CANNOT CURRENTLY DISTINGUISH THE TWO REMAINING HYPOTHESES. Both trySurfaceOkErrorBody and tryRecoverErrorContent wrap the clone parse in a bare catch that returns null, so an AbortError thrown by clone.json() when the 90 s timer fires mid-body is swallowed, the original response is handed back, and the SDK's own body read then throws the AbortError the log shows. That sequence is consistent with (A) an upstream body stall — the provider or OpenRouter sent 200 headers early and the body never completed (whether OpenRouter emits headers before the upstream body completes on non-streaming requests is UNVERIFIED; not probed, would need a live call) — and with (B) a downstream consumer stall after a complete body. Only a timing line at body-complete separates them.

Fix shape, sharpened: ship the diagnostic as permanent observability (feat, not debug) in OpenRouterFetch.ts — one info line after a successful clone parse carrying elapsed ms since the fetch resolved and the parsed body length, and a warn in each catch carrying the error name and the same elapsed ms instead of swallowing silently. Unit test pins both lines (the existing JSON-parse-failure case is the fixture for the catch path). No behaviour change. On the next occurrence: a warn naming AbortError at ~85 s means (A), body never arrived; an info line followed by the gap means (B), look at LangChain/SDK response handling. Decide the real fix only from that observation.

STEP 1 SHIPPED — PR 2323, merged to develop at 7783c95fb. The custom fetch now reads the clone as text once for both inspections and logs Custom fetch body parsed with bodyMs (elapsed since the headers) and bodyChars, or Custom fetch body inspection failed with errName and bodyChars (a number when text arrived but did not parse, absent when the read itself rejected). No behaviour change; 32 cases in OpenRouterFetch.test.ts, full ai-worker suite green. This task is now a WATCH: the next vision-tier timeout in prod is read by those two lines on the tier that timed out. A warn naming AbortError with bodyChars absent at about 85 s after the headers is hypothesis A (the body never arrived — upstream or OpenRouter stall behind early 200 headers); a parsed line and then the gap is hypothesis B (a downstream stall after a complete body; look at LangChain/SDK response handling). Decide the fix from that reading, not before. Remaining open questions: whether OpenRouter sends 200 headers before the upstream body completes on non-streaming calls (unverified), and the owner-visible chain-diversity finding above, which is a product call.
<!-- SECTION:DESCRIPTION:END -->
