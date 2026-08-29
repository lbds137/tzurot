---
id: TASK-789
title: >-
  Paid-path vision invocation sends prefixed z-ai model id to the z.ai API — 400
  code 1214
status: To Do
assignee: []
created_date: '2026-08-28 02:55'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 789000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: first live test of flash as the PAID global vision default (owner, 2026-08-28 02:44Z dev, requestId d9813774-0da9-420a-8364-a3b0995b3370): the image-job vision invocation sent modelName="z-ai/glm-5.3-flash" and z.ai returned 400 code 1214 "modelCode: does not exist" (apiKeySource="system", isGuestMode=false). The walk degraded to a lower tier and the description succeeded, so the failure is invisible to the user — every fresh image just burns a failed call first. The SAME config (GLM 5.3 Flash Reasoning: high, model z-ai/glm-5.3-flash) works on the TEXT path (runtime-verified during the beta.209 piggyback swap), and the GUEST vision path invokes flash successfully with the bare id (2026-08-27 21:45Z logs) — so the code-read hypothesis is the prefixed OpenRouter-form id reaching the z.ai endpoint unstripped on the non-guest vision path; runtime-confirm the provider/client seam at fix time per /tzurot-bug-remediation before building.

Rider: the 400 was classified errorCategory="bad_request" errorType="transient" shouldRetry=true — z.ai 1214 is a permanent config error; retrying costs ~7s before fallback. Check the z.ai error-code classification alongside the fix.

Fix shape: normalize the z-ai/ prefix at the vision invocation seam for z.ai-direct providers, mirroring whatever the working text path does (grep how the ZaiCoding/text client normalizes); regression test pinning that a prefixed stamped id crosses the z.ai client boundary bare; class-sweep any other path that passes stamped model ids to z.ai unmodified.

Acceptance: with the paid global vision default pointed at the flash config, a fresh image is described BY flash (success log with the bare model id, no 1214); both prefixed and bare config forms work; the 1214 class no longer retries.

STATUS 2026-08-28: PRIMARY CLAUSE SHIPPED in PR 2240 (rode the beta.209 cut, owner gate) — buildZaiCodingModel strips the prefix at the client boundary, proven-red regression tests (prefixed, bare, mixed-case), two clean review rounds. Review round 2 confirmed the fix ALSO closes the explicit provider:zai-coding TEXT route (ProviderRouter.ts:170-195 passes the configured model unstripped; only auto-promotion stripped). OPEN REMAINDER, in order: (1) ✅ RUNTIME-CONFIRMED IN PROD 2026-08-29 (owner prompted the check; beta.209 deployment 3fdbfcfb, ai-worker log window 2026-08-29T03:46–13:34Z). Job llm-4c6427dc-9cc9-42f8-94a2-0a2e2ee3641c at 04:39Z: isGuestMode=false, "Auto-promoting OpenRouter z-ai/ model to z.ai-direct (user has zai-coding key)", vision invoked on z-ai/glm-5.3-flash, then "Extended context images processed successfully" → "Generation completed" → "Job completed". ZERO 1214 errors in the window (six raw greps for "1214" were all coincidental digits — timestamps and a chars":91214 section count; "modelCode" matched nothing). Exactly one vision failure in the window and it is a DIFFERENT bug: z.ai content-safety 400 ("System detected potentially unsafe or sensitive content") at 05:43Z, handled correctly by advancing to openrouter/auto. SCOPE CAVEAT, stated because the observed scenario is not byte-identical to the filed one: the original report was apiKeySource="system" with isGuestMode=false; prod exercised isGuestMode=false with a USER zai-coding key. Code-reading says buildZaiCodingModel's strip is key-source-independent so the system-key variant should behave the same, but that is an inference, not the observation — if the system-key arm needs pinning, it needs its own probe. (2) the retry-classification rider above — deferred deliberately: BAD_REQUEST is a designed member of TRANSIENT_ERROR_CATEGORIES (error.ts:331-336) and z.ai 1214 matches no MODEL_NOT_FOUND pattern; hoisting it touches quota-retarget + vision-failure-cache semantics, too broad for a single specimen. SECOND SPECIMEN 2026-08-29 (the condition that deferral named): the 05:43Z prod content-safety 400 above was classified category="bad_request" and logged by VisionFallbackLoop as "failed on a retryable category". A content-policy rejection is permanent for that image. NOTE the behaviour here was arguably CORRECT and this is not yet a confirmed bug — the loop advanced to a DIFFERENT model (openrouter/auto) rather than retrying the same one, and a different provider may legitimately not trip z.ai's filter; it also cached the failure negatively for 3600s. So the specimen sharpens the question rather than answering it: is "retryable" the wrong WORD for a category that drives model-advance rather than same-model retry, or the wrong CLASSIFICATION? Decide that before hoisting anything. (3) ✅ SHIPPED in PR 2250 (2026-08-29, merged f3ac30adb) — but NOT as this clause described it, and the difference is the finding. The clause said "extract a shared strip helper in constants/ai.ts". The helper already existed (`stripZaiPrefix`) and was NOT a drop-in: it lowercases in BOTH branches because its output is a catalog KEY, so reusing it on the wire path would have changed the case of the id sent to z.ai — in the very task that exists because a malformed wire id 400s. Shipped instead a case-PRESERVING sibling `toZaiWireModelId` (case-insensitive detect), adopted at the two wire sites (buildZaiCodingModel, systemModelCall). Adopting it in systemModelCall is a deliberate WIDENING, not a refactor: that check was case-sensitive, so `Z-AI/glm-5` previously reached z.ai unstripped — pinned by its own proven-red test. z.ai's actual case-sensitivity remains UNVERIFIED and the JSDoc hedges rather than asserting it. The ChatModelResult.modelName wire-form comment also landed, on the field itself.

Note the clause's "five inline catalog-helper strips" was wrong too: the sweep found three strip sites, not five (the rest are boolean membership CHECKS, not strips), and the third — ProviderRouter.ts:252, case-sensitive detect with lowercasing output — was deliberately left alone because it serves catalog promotion rather than the wire.

REMAINING ON THIS TASK: only clause (2), the retry-classification rider. Clauses (1) and (3) are closed.
<!-- SECTION:DESCRIPTION:END -->
