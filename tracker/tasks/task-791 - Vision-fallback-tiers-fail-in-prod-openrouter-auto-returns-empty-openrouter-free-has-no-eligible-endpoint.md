---
id: TASK-791
title: >-
  Vision fallback tiers fail in prod: openrouter/auto returns empty,
  openrouter/free has no eligible endpoint
status: To Do
assignee: []
created_date: '2026-08-28 14:45'
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
<!-- SECTION:DESCRIPTION:END -->
