---
id: TASK-791
title: >-
  Vision fallback tiers fail in prod: openrouter/auto returns empty,
  openrouter/free has no eligible endpoint
status: Done
assignee: []
created_date: '2026-08-28 14:45'
updated_date: '2026-09-02 04:08'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 791000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod ai-worker logs for the beta.209 deployment (2026-08-28 04:18Z-13:30Z window) show 21 vision fallback chains fully exhausted against only 3 completed image descriptions. Most images posted to prod in that window got no description at all. Tally taken from the VisionDescriptionCache negative-cache log lines, which carry model and category as structured fields (not adjacency guessing): openrouter/auto 20x empty_response + 1x quota_exceeded; openrouter/free 1x model_not_found; z-ai/glm-5.3-flash 14x rate_limit + 13x bad_request.

Owner call 2026-08-28: the FALLBACK tiers are the defect, not the flash primary. openrouter/auto is meant to serve paid users and openrouter/free the guests; Qwen was also censoring images, so flash is not a regression and swapping it back would not touch the exhausted chains.

### 2026-08-28 investigation — lead 1 was mis-stated; the 402 is OUR bug, not the account's

Both original leads were filed as account-side. Lead 1 is now diagnosed and it is a CODE defect. Corrected here rather than annotated, because the original sentence read as "the owner needs to top up" and that is false.

Evidence: 5-deployment, 25005-line prod ai-worker sweep (deployments 3fdbfcfb, fa716f8f, 2fa68c16, a311533f, 93fcb786), grepped locally. Positive control 1193 requestId lines. Exactly 9 real HTTP-402 lines, all one event at 2026-08-28T07:24:34Z, all modelName="openrouter/auto":
- requested up to 65536 tokens, can only afford 5677
- requested up to 64000 tokens, can only afford 28389

Confirmed by trace, and this part still holds: the vision path sends NO max_tokens. maxTokens is optional in VisionTierParams (packages/common-types/src/types/schemas/personality.ts:37), defaults to undefined, and getEffectiveMaxTokens (services/ai-worker/src/services/ModelFactory.ts:333-359) applies no clamp — it only scales for reasoning models WITH a thinking param, and vision passes neither. So the value reaches the provider unset.

WHERE THE 65536/64000 FIGURES COME FROM IS UNRESOLVED — corrected 2026-08-28 after review challenged the original claim here. This task first stated that the provider reserves the routed model's full output capacity up front. Do not repeat that as fact. Against it: the reading rested on the failing calls being VISION calls, and prod has fallbackTextModel AND fallbackVisionModel both set to openrouter/auto, so the routed model name cannot tell a caption apart from a chat turn. Against the competing explanation (that 65536 is our own REASONING_MODEL_MAX_TOKENS.max): that value needs thinking=max, and no prod llm_config exceeds high (32768), none carries an explicit max_tokens, and 64000 matches no constant of ours. Checked at config level only — a user-level override could still set it, and that was not checked. Two differing sizes in one event remains the one fact neither story explains away comfortably.

Consequence either way: an unbounded ask can exceed the key's available balance and be refused. The account is NOT out of credit — the affordable figure was nonzero and different each retry.

Ruled out, same sweep: zero credit-exhaustion cache writes (that cache is marked only on ACCOUNT-level 402s, so parseApiError itself classified these as request-level), and every cacheKeyId in 25005 lines is `system` — no `user:<snowflake>` bucket appears, so no BYOK user's key was involved. Attribution mechanism for any future occurrence: the Redis key is `nocredits:openrouter:system` vs `nocredits:openrouter:user:<discordId>` — but its TTL is 10 minutes (CreditExhaustionCache.ts:47), so a live read answers only "right now"; the logs are the historical instrument.

Fix shape (owner-approved 2026-08-28): give the vision path a real maxTokens default of 2000. An image description runs a few hundred tokens; 2000 is generous and makes the reservation trivially affordable. No account change required. Raising the key's monthly limit would mask this without fixing the absurd reservation.

2. STILL OPEN, and NOT a defect: the openrouter/free 404 reads "No endpoints available matching your guardrail restrictions and data policy". Owner call 2026-08-28: the OpenRouter privacy settings are deliberate Discord-ToS compliance — Discord's developer terms prohibit training on user data, which the owner reads as barring the bot from routing user content to providers that train. That is a defensible reading and the setting stays. The consequence is real (free-tier vision has no eligible endpoint) but it is a constraint to design around, not a bug to fix. Open sub-question: z.ai's own training policy is unknown, and the piggyback path sends guest traffic to z.ai DIRECTLY, outside OpenRouter's controls — so OpenRouter's data policy does not govern it in either direction.

Still uninstrumented after this fix: VisionProcessor logs the requested modelName but NOT which concrete model openrouter/auto routed to, so an empty_response from auto still cannot be distinguished from auto picking a non-vision model. That gap explains the 20 empty_response results, which this fix does NOT address.

Acceptance: a fresh image in prod is described without exhausting the chain; the exhaustion rate (21 per 9 hours at filing) drops to near zero. The 402 half is closed by the maxTokens cap; the empty_response half needs the routed-model instrumentation above.

### 2026-09-02 — recurrence, mechanism identified, fix PR #2295 (owner: fix in beta.213)

Recurred in prod 2026-09-02 00:55Z and 00:58Z (same attachment, two turns): chain tiers=["z-ai/glm-5.3-flash","openrouter/auto"] exhausted — flash 400 content-safety refusal (bad_request), then openrouter/auto "Model returned zero choices" (empty_response, 600s negative cache). The auto attempt ran with source="user" (a BYOK key), and the chain had only two tiers because the personality had no stamped visionFallbackModels and the prod fallbackVisionModel setting is the router alias.

Mechanism (verified against OpenRouter's published error reference, fetched 2026-09-02): when a provider fails after returning headers, OpenRouter answers HTTP 200 with a body holding only an `error` object and no `choices`. The custom fetch only inspected non-ok responses, so the body reached @langchain/openai, produced zero generations, and the provider's diagnosis (error.code / message / metadata.provider_name / model_slug) was discarded before classification — which is exactly the "cannot be distinguished" gap named above. `readRoutedModel` cannot help here: there is no message to carry response_metadata.

Fix shape (shipped as PR #2295): (A) OpenRouterFetch restates a 200-with-error-and-no-choices body as a real error response (status = error.code when 400-599, else 502) so the existing parser classifies it, with a warn log carrying the safe diagnosis fields and never metadata.flagged_input; (B) composeVisionTiers appends MODEL_DEFAULTS.VISION_FALLBACK after an openrouter/auto paid floor (non-guest only; cap stays 3; guests and keyless users still forced to the free floor by resolveVisionAuth, pinned per-model). The 402 half was already SHIPPED (VISION_MAX_TOKENS 4000, not the 2000 sketched above — re-sized off a measured description distribution).

### 2026-09-02 — acceptance OBSERVED in prod; task closed, residuals carried

Two post-deploy walks of the same photo, both logged by VisionFallbackLoop / VisionProcessor:
- 03:14:59Z (extended-context re-walk of the 00:55 attachment after its negative-cache entries lapsed): flash 429 rate_limit → advance; openrouter/auto zero choices (empty_response) → advance; **qwen/qwen3.5-397b-a17b responded at 03:15:32Z**. The 03:36Z /inspect log carries that description inside the quoted 20:55 message; the persona's "customs still holds it" reply was narrative continuity, not a vision failure.
- 03:49:37Z (owner re-upload, direct attachment): flash provider_content_refused (the #2280 classification, 1h) → advance; auto zero choices → advance; **qwen responded at 03:50:10Z**, a 2,655-char description the persona used in full.

"A fresh image in prod is described without exhausting the chain" — met twice. The exhaustion-rate clause is a longer watch; the chain now cannot end on a router alias, so the beta.209 shape (21 exhaustions / 9h) is structurally closed.

Residuals, each on its own task: **TASK-863** (high) — the 200-with-error surfacing from #2295 never ran on either walk because the OpenRouter custom fetch is only installed when a model config carries transforms/route/verbosity/thinking, which a vision call never does; so WHY auto returns zero choices for images is still uninstrumented. **TASK-864** — the /inspect log does not record which vision model produced a description. **TASK-860** — the guest free-floor eligibility watch (point 2 above).
<!-- SECTION:DESCRIPTION:END -->
