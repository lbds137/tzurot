---
id: doc-77
title: 'Theme: OpenRouter-to-z.ai request normalization (gates GLM-5.3 support)'
type: other
created_date: '2026-08-14 16:22'
---

### Theme: OpenRouter-to-z.ai request normalization

_Focus: every LLM config is authored in OpenRouter's parameter vocabulary, but some requests are routed to z.ai's own API — build the translation layer that makes that safe, before GLM-5.3 support lands._

Owner framing (2026-08-14): "all of the LLM configs kind of default to OpenRouter, and then we have our own separate path for upgrading the OpenRouter request to use z.ai instead... we might need to have our own normalization or standardization layer... this might be a good time to dig deep into what exactly do we need to do to transform OpenRouter-compatible requests to z.ai-compatible requests. That's probably not a small effort, but it's something that we should do before we start supporting GLM-5.3."

## Why now

GLM-5.3 shipped 2026-08-14. Launch coverage reports its thinking API takes three effort levels — low, high, max — and that thinking can no longer be disabled. The owner currently runs `medium`, which is not in that set. Whether or not that specific report survives a probe, it is the forcing function: our config vocabulary and z.ai's are already different alphabets, and nothing translates between them.

## What is actually true today (grounded 2026-08-14, file:line)

**There IS a partial normalization layer, and it is name-based only.** `ModelFactory.ts:42` defines `ZAI_DIRECT_UNSUPPORTED_PARAMS` — an 8-name strip list (`frequency_penalty`, `presence_penalty`, `repetition_penalty`, `seed`, `top_k`, `min_p`, `top_a`, `logit_bias`) applied when `effectiveProvider === AIProvider.ZaiCoding` (`ModelFactory.ts:85`). So the starting premise "there is no normalization" is not quite right; what exists drops unsupported param NAMES and cannot touch VALUES.

**The strip list does not include `reasoning`.** `buildModelKwargs` (`ModelFactory.ts:209`) is documented as building params "that OpenRouter/OpenAI accept", and `buildReasoningParams` (`ModelFactory.ts:176`) bakes in an explicitly-named "OpenRouter constraint" (only one of `effort` or `max_tokens`). It sets `params.effort = reasoning.effort` verbatim, with no provider branch anywhere in the path. `buildZaiCodingModel` (`ModelFactory.ts:477`) then passes that same `modelKwargs` object straight through to a `ChatOpenAI` pointed at `AI_ENDPOINTS.ZAI_CODING_BASE_URL`.

**z.ai does not document a `reasoning` param.** Our own comment at `ModelFactory.ts:33-36` records z.ai's supported set as temperature, top_p, max_tokens, stop, **thinking**, tools, tool_choice, do_sample, response_format, stream — and states that anything outside it yields 400 "Invalid API parameter" (code 1210). The thinking-control field is `thinking`; ours is `reasoning`.

**The response direction already knows the protocols differ.** `ModelFactory.ts:481-485` deliberately withholds `__includeRawResponse` for z.ai because "z.ai uses its own thinking-field protocol, not OpenRouter's reasoning bridge". The request direction never got the same treatment.

## The open question that must be probed first

Code-reading says we send a `reasoning` object to an API that documents `thinking` and 400s on unknown params — yet the owner reports `medium` "seems to work" on current GLM models. Exactly one of these must be true, and they are NOT equally bad:

- **(a)** z.ai silently ignores the unknown `reasoning` param → thinking control on the z.ai-direct path is **currently a no-op**, and every effort setting the owner has chosen there has had no effect.
- **(b)** These requests are not actually reaching z.ai-direct (auto-promotion requires a stored zai-coding key; without one, `ProviderRouter` falls through to OpenRouter) → the setting works because it is going to OpenRouter after all.
- **(c)** z.ai accepts `reasoning` despite the documented list.

This is code-reading, not runtime observation, so none of the three may be asserted yet. **Phase 0 exists to distinguish them**, and the answer changes the whole shape of the work: (a) is a live silent-misconfiguration bug, (b) means the z.ai path is less exercised than assumed, (c) means the documented contract is wrong and our strip list is over-broad.

## Phases

### Phase 0 — Establish which world we are in (do this first, small)

- [ ] Determine whether real traffic reaches z.ai-direct: is a zai-coding key stored, and does `ProviderRouter` auto-promotion actually fire for the owner's presets? Log or `/inspect` evidence, not inference.
- [ ] Capture one real z.ai-direct request body and its response. Confirm whether `reasoning` is present, and whether z.ai 400s, ignores it, or honours it.
- [ ] Record the answer here before any code changes. Everything below is scoped by it.

### Phase 1 — Audit the full param surface, both directions

- [ ] Enumerate every field we can put on an outbound request (sampling, output control, reasoning, response_format, stop, tools) and mark each: supported by z.ai / stripped today / silently passed / needs translation.
- [ ] Do the same for VALUES, not just names — the strip list is name-based and cannot catch an out-of-range enum. `reasoning.effort` is the known case; check `stop` (z.ai documents max 1) and `response_format` too.
- [ ] Include the response direction, so the thinking-field protocol gap is documented in the same place rather than rediscovered.

### Phase 2 — A real translation seam

- [ ] Introduce a provider-normalization step that owns OpenRouter-shape → z.ai-shape, replacing the name-only strip list. The existing seam boundary (`ProviderRouter` resolves the route; `ModelFactory` builds the client) is the natural place for it.
- [ ] Map our effort vocabulary (`xhigh`/`high`/`medium`/`low`/`minimal`/`none`) onto whatever z.ai actually accepts, including the reported 5.3 trio. Decide per level whether it maps, rounds, or is rejected — and make rejection visible rather than silent.
- [ ] Do NOT let a value we cannot represent reach z.ai. The owner's requirement: "ensure that we don't make it possible to pass an invalid value to z.ai."

### Phase 3 — Validate at config time, not just request time

- [ ] An LLM config that pins an effort level unsupported by its provider should be rejected or warned about when it is SAVED, not silently degraded on every generation. Today the levels are a single global union (`REASONING_EFFORT_LEVELS`, `packages/common-types/src/schemas/llmAdvancedParams.ts`) with no provider dimension.

### Phase 4 — GLM-5.3 enablement

- [ ] Only after the above: add 5.3, with its effort vocabulary expressed through the Phase 2 mapping. Probe the "thinking cannot be disabled" claim directly rather than trusting launch coverage.

## Related

- **TASK-609** — the original narrow filing (effort `none` may become invalid). Superseded in scope by this theme; keep it as the watch for 5.3 becoming available.
- The GLM-family reasoning-tag vocabulary churn already handled model-agnostically in the Chain-of-Extractors is the response-side sibling of this request-side gap.
