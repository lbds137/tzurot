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

## ⚠️ PHASE 0 CLOSED (owner discriminator, 2026-08-14) — (a) CONFIRMED: thinking control on z.ai-direct is a live no-op

The owner ran the discriminator on dev: the same character, two configs
differing only in `reasoning.effort`, one minute apart. Result below; the
earlier prod-log section is kept underneath because it establishes the
context this rests on.

| | effort `none` | effort `high` |
| --- | --- | --- |
| requestId | `e6ae070b-…0285ef` | `74c8c2dd-…33a620` |
| `effectiveProvider` | `zai-coding` | `zai-coding` |
| sent `modelKwargs` | `{"reasoning":{"effort":"none","exclude":false,"enabled":true}}` | `{"reasoning":{"effort":"high","exclude":false,"enabled":true}}` |
| **reasoning returned** | **1571 chars** | **1722 chars** |

Three independent dev log lines pin each request to the direct path —
`ProviderRouter` "Auto-promoting…", `AuthStep` `effectiveProvider="zai-coding"
wasAutoPromoted=true fallthroughTriggered=false`, and `ModelFactory` "Creating
z.ai coding model" printing the exact outbound `modelKwargs`. This is not
inference from a config label.

**`effort: "none"` is documented in our own schema as "0% (reasoning
disabled)". It produced 1571 characters of reasoning.** If the parameter were
honoured that number must be zero. The 1571 → 1722 delta is ~10% across two
different prompts — run-to-run variance, not a dose-response curve.

So thinking control on the z.ai-direct path does nothing, and has not for as
long as the path has existed. **This is user-facing and costs money**: a config
set to `none` still generates and bills reasoning tokens the owner explicitly
asked not to have, and `high`/`xhigh` cannot buy more.

**RESIDUAL AMBIGUITY RESOLVED — third run, `enabled:false` with `effort`
absent (requestId `55b4994a-…ae6a9b`).** Same three log lines pin it to the
direct path, and `ModelFactory` printed the outbound payload verbatim:
`modelKwargs={"reasoning":{"exclude":false,"enabled":false}}`. Result:
**1776 chars of reasoning** — the LARGEST of the three runs.

| sent | reasoning returned |
| --- | --- |
| `{effort:"none", enabled:true}` | 1571 |
| `{effort:"high", enabled:true}` | 1722 |
| `{enabled:false}` (no `effort`) | **1776** |

So `enabled` is inert too. **z.ai ignores the entire `reasoning` object** —
not just the `effort` value — and the ordering is anti-correlated with intent,
which is what "ignored" looks like. Nothing we currently send about thinking
has ever reached z.ai.

This makes the Phase 2 fix unambiguous: there is no partial capability to
preserve, no "enabled works, effort doesn't" path to special-case. The whole
object needs translating to z.ai's `thinking` field, and until it is, the
z.ai-direct path runs at z.ai's default with no control surface at all.

Note the response direction is fine and always was — `ResponsePostProcessor`
logs "Found reasoning in additional_kwargs.reasoning_content (z.ai
convention)". We already speak z.ai's response protocol. Only the request
direction never learned it.

Phase 1's audit is also confirmed live by the same lines: `filteredParams=["top_k","min_p"]`
shows the strip list working, while `reasoning` passes straight through beside it.

---

## Phase 0 RESULT (prod logs, 2026-08-14) — (b) falsified, (c) confirmed, (a) then still open

Evidence is a single fully-correlated prod job, `llm-842a8368-9b8d-47ca-8ea7-99fd6a66322d`,
plus a wider sweep of the same deployment. Runtime observation, not code-reading.

**(b) is FALSIFIED — z.ai-direct is live in prod.** `ProviderRouter` logs
`Auto-promoting OpenRouter z-ai/ model to z.ai-direct (user has zai-coding key)`
repeatedly across the window, for more than one user and more than one model
(`z-ai/glm-4.5-air`, `z-ai/glm-5.2`). On the correlated job,
`ContextWindowResolver` independently reports `effectiveProvider="zai-coding"`,
so that request definitively took the direct path.

**(c) is CONFIRMED, and it falsifies our own comment.** The job ran under the
admin default config named `GLM 4.5 Air (Reasoning: medium)` — so `reasoning:
{effort: 'medium'}` was in `modelKwargs` — and `LLMInvoker` reports
`succeeded on attempt 1`, 43s, no retry. **No 400, no code 1210.** z.ai
therefore does NOT reject the undocumented `reasoning` key. The claim at
`ModelFactory.ts:33-36` that "anything outside that list yields 400 'Invalid
API parameter' (code 1210)" is **too strong** — it is true of the specific
params observed to fail (`frequency_penalty`, `presence_penalty`) and false as
a general rule. That comment should be narrowed to what was actually observed
when Phase 1 touches this file.

**(a) is NOT resolved — accepted is not honoured.** The response carried
`reasoning_content` (`additionalKwargsKeys=["function_call","tool_calls","reasoning_content"]`)
and `ResponsePostProcessor` logged `reasoningRequested=true
reasoningActuallyEngaged=true apiReasoningLength=3391
thinkingContentLength=3391` — all 3391 chars came from the API field, none
from inline tag extraction. But **GLM-4.5-Air is a hybrid-reasoning model that
thinks by default**, so a populated `reasoning_content` is equally consistent
with "z.ai honoured effort=medium" and with "z.ai ignored the param and the
model thought anyway". This observation cannot separate them.

**Discriminator for the remaining question** (cheap, owner-driven): issue the
same prompt on the z.ai-direct path under two configs differing ONLY in
`reasoning.effort` — e.g. `none` vs `high` — and compare `apiReasoningLength`
in the `Reasoning mode engaged` log line. If the value does not move, z.ai is
ignoring the param and thinking control on that path is a no-op. Needs the
owner to drive Discord (`/tzurot-testing`), so it is not self-servable.

**Incidental finding, same job — filed as TASK-611.** The z.ai path logs
`[OpenRouterReasoning] Expected __raw_response in additional_kwargs but found
none — verify ChatOpenAI __includeRawResponse setting and @langchain/openai
version` on every request. `ModelFactory.ts:481-485` withholds
`__includeRawResponse` for z.ai **deliberately**, so this is the OpenRouter
reasoning bridge running on a path that intentionally opted out of it and
complaining about the expected absence. Extraction still works (the field is
read from `additional_kwargs` directly), so it is log noise rather than a
functional break — but it is a warning-shaped line on a healthy path, which
trains the eye to ignore it.

## Phases

### Phase 0 — Establish which world we are in (do this first, small) ✅ DONE 2026-08-14

- [x] Determine whether real traffic reaches z.ai-direct — YES, confirmed in prod logs (see result above).
- [x] Capture one real z.ai-direct request and its response — captured via correlated prod job; z.ai accepts `reasoning` without a 400.
- [x] Record the answer here before any code changes.
- [ ] **Remaining**: run the effort-level discriminator above to settle honoured-vs-ignored. Owner-driven; gates how urgent Phase 2's mapping is.

### Phase 1 — Audit the full param surface, both directions ✅ NAME AUDIT DONE 2026-08-14

**Result: the outbound surface is already correctly handled EXCEPT `reasoning`.**
This is a materially smaller finding than the theme assumed, and it should
shrink Phase 2. The authored vocabulary is `AdvancedParamsSchema`
(`packages/common-types/src/schemas/llmAdvancedParams.ts`) — every field it
can carry, traced to what actually reaches z.ai:

| Authored field                                                    | Carrier                     | On the z.ai-direct path                                                                              |
| ----------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `temperature`, `top_p`, `max_tokens`                              | first-class `ChatOpenAI`    | passed — z.ai documents all three ✅                                                                   |
| `frequency_penalty`, `presence_penalty`                           | first-class                 | stripped by `filterRestrictedParams`, AND re-excluded at the constructor ✅                            |
| `top_k`, `repetition_penalty`, `min_p`, `top_a`, `seed`           | `modelKwargs`               | stripped by name ✅                                                                                    |
| `logit_bias`                                                      | `modelKwargs`               | stripped by name ✅                                                                                    |
| `response_format`                                                 | `modelKwargs`               | passed — z.ai documents it ✅ (VALUE not yet checked: we emit `text`/`json_object`)                    |
| `transforms`, `route`, `verbosity`                                | `buildOpenRouterExtraParams`| never reaches z.ai — that builder is called ONLY from `buildOpenRouterModel:373`, path-scoped ✅       |
| `show_thinking`                                                   | neither                     | never leaves the service; not in `buildModelKwargs`, not a constructor arg. Display-side flag ✅       |
| **`reasoning.{effort,max_tokens,exclude,enabled}`**               | `modelKwargs` as `reasoning`| **passed through untranslated — the single hole** ❌                                                   |

Two of the theme's own worries are non-issues, verified rather than assumed:

- **`stop` is never emitted.** It is not in `AdvancedParamsSchema` at all, and
  a grep across ai-worker and the schemas finds only a `finish_reason: "stop"`
  comment. z.ai's documented max-1 constraint cannot bite something we never
  send.
- **The OpenRouter-only trio is already path-scoped**, not by a strip list but
  by construction — `buildZaiCodingModel` simply never calls the builder that
  produces them. That is the shape Phase 2 should copy.

**So Phase 2 is narrower than "build a general translation layer":** handle
`reasoning`, and add a guard so the NEXT unhandled param cannot slip through
silently the way this one did. The strip list is a denylist, which is why a
newly-added field defaults to being sent; an allowlist (or a test asserting
every `AdvancedParamsSchema` key has a declared z.ai disposition) would have
caught `reasoning` at authoring time.

Remaining Phase 1 work:

- [ ] VALUE audit, not just names — `reasoning.effort` is the known case;
      confirm z.ai accepts our `response_format` values.
- [ ] Response direction, so the thinking-field protocol gap is documented
      here rather than rediscovered. Partly answered by Phase 0: the response
      arrives as `reasoning_content` in `additional_kwargs` and IS extracted.

### Phase 2 — A real translation seam

- [ ] Introduce a provider-normalization step that owns OpenRouter-shape → z.ai-shape, replacing the name-only strip list. The existing seam boundary (`ProviderRouter` resolves the route; `ModelFactory` builds the client) is the natural place for it.
- [ ] Map our effort vocabulary (`xhigh`/`high`/`medium`/`low`/`minimal`/`none`) onto whatever z.ai actually accepts, including the reported 5.3 trio. Decide per level whether it maps, rounds, or is rejected — and make rejection visible rather than silent.
- [ ] Do NOT let a value we cannot represent reach z.ai. The owner's requirement: "ensure that we don't make it possible to pass an invalid value to z.ai."

### Phase 3 — Validate at config time, not just request time

- [ ] An LLM config that pins an effort level unsupported by its provider should be rejected or warned about when it is SAVED, not silently degraded on every generation. Today the levels are a single global union (`REASONING_EFFORT_LEVELS`, `packages/common-types/src/schemas/llmAdvancedParams.ts`) with no provider dimension.
- [ ] **Collapse `reasoning.enabled` vs `reasoning.effort: 'none'`** — see the census below. Owner-flagged as redundant 2026-08-14; prod data confirms it has already produced split encodings of one intent.

## Prod config census (read-only query, 2026-08-14) — 39 `llm_configs`

**Every z.ai-routed config is identical and every one is affected by the no-op.**
All 5 are global, all carry `{effort: "medium", enabled: true, exclude: false}`:
`GLM 4.5 Air`, `GLM 4.7`, `GLM 5`, `GLM 5.1`, `GLM 5.2` — each named
"(Reasoning: medium)". So every GLM preset in the system advertises `medium` in
its own name while actually running whatever z.ai's default is. The blast
radius of the Phase 0 finding is 5/5, not a subset.

**The `enabled` / `effort` redundancy is real and has already split the data.**
Two encodings of "no reasoning" are both in active use:

| Encoding | Count | Examples |
| --- | --- | --- |
| `{enabled: false}`, no `effort` | 5 | `Kimi K2.5 (Reasoning: none)`, `Kimi K2.6 (Reasoning: none)`, `Cogito v2.1 671B`, `OpenRouter Free Router`, `Qwen 3.7 Plus` |
| `{enabled: true, effort: 'none'}` | 4 | all four `Gemma 4 …(Reasoning: none)` variants |

Six of those nine are literally named **"(Reasoning: none)"** — the same
user-visible intent, stored two incompatible ways, and one of the two is
internally contradictory (`enabled: true` alongside a zero budget). This is not
a theoretical tidiness concern; it is drift that already happened.

Note this also means the Phase 0 residual ambiguity **cannot** be settled from
prod data: no z.ai-routed config uses `enabled: false`, so there is no existing
config whose generation would separate "z.ai ignores the whole object" from
"z.ai honours `enabled`". Settling it still needs one purpose-made config.

**`show_thinking` is switched on by nobody.** Of 39 configs: 23 explicitly
`false`, 16 absent, **0 true**. Scope of that claim: `llm_configs` only — I did
not sweep per-user overrides.

It is NOT dead code, and the distinction matters for the removal decision. The
chain is fully wired and terminates in a real external effect: preset UI /
import-export write it → `LlmConfigResolver:264` → `RAGUtils:459` →
`GenerationStep:274/311` → result metadata → `SlotDeliveryService:137` →
`DiscordResponseSender:177`, where `options.showThinking === true` gates an
actual extra Discord message. So this is an unused *capability*, not orphaned
code — removing it is a product call about whether inline reasoning display
should be offered at all, not a dead-code cleanup. Owner leaning toward removal
2026-08-14 ("probably a bit redundant… might be a dead feature"), reasoning that
`/inspect` already covers the need. Related: **doc-73** part 1 wants reasoning
one click away via a context-menu command — if that ships, inline display has
even less reason to exist, so the two decisions belong together.

### Phase 4 — GLM-5.3 enablement

- [ ] Only after the above: add 5.3, with its effort vocabulary expressed through the Phase 2 mapping. Probe the "thinking cannot be disabled" claim directly rather than trusting launch coverage.

## Related

- **TASK-609** — the original narrow filing (effort `none` may become invalid). Superseded in scope by this theme; keep it as the watch for 5.3 becoming available.
- The GLM-family reasoning-tag vocabulary churn already handled model-agnostically in the Chain-of-Extractors is the response-side sibling of this request-side gap.
