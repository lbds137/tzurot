# LangChain reasoning extraction silently drops content (investigation)

> **Date**: 2026-04-25
> **Source**: User-reported GLM-4.7 leak in inspect log → multi-hour debug session
> **Status**: Active investigation — bug isolated, root cause hypothesized, fix not yet implemented

## TL;DR (read first thing)

**Our `OpenRouterFetch` interceptor extracts `message.reasoning` from API responses and injects `<reasoning>...</reasoning>` tags into `message.content` BEFORE returning the Response to LangChain. The interceptor runs successfully (~89%+ of GLM requests). MOST of the time those tags survive into `response.content` and `/inspect` shows the reasoning correctly. But ~11% of the time on GLM-4.7, the tags are gone by the time `model.invoke()` returns, even though the interceptor's `reasoningInjected=true` log fires.** Something between our interceptor's `new Response(JSON.stringify(body), ...)` and LangChain's eventual `BaseMessage.content` is **intermittently** stripping or bypassing our injected tags.

The 11% intermittent failure rate matches the user-visible "leak" rate. Each of those failures is doubly bad: (a) reasoning content is dropped from `/inspect` audit (the reasoning was extracted but disappears), and (b) when the model ALSO embedded planning prose in `content` directly, that planning becomes user-visible because we're not masking it with the structured reasoning content.

The user's perception that "leaks are happening more often" reflects this intermittent-failure rate. The bug isn't 100% silent loss; it's an **intermittent loss in a specific 11% of conditions** that we need to identify.

**Important correction (2026-04-25 user feedback)**: An earlier draft claimed reasoning was lost on EVERY request. That was wrong — `/inspect` does show reasoning successfully on most requests. The bug is the intermittent failure mode, not the steady-state.

## Evidence

### Smoking gun #1: interceptor fires successfully

`railway logs c2f51bd9-cbe5-4b19-a998-270d946174d4 --service ai-worker --environment production --filter "Inspecting"` shows the interceptor running on every reasoning-enabled request:

```
2026-04-25T04:33:46.695Z [INFO] [ModelFactory] Inspecting response message for reasoning content
  messageKeys=["role","content","refusal","reasoning","reasoning_details"]
  hasReasoning=true reasoningLength=1994 hasReasoningDetails=true

2026-04-25T04:33:46.695Z [INFO] Response interception complete
  reasoningInjected=true
```

For request `30a5af6d-6c29-458d-a6ed-9f817f1f6364` (the user's leaked Lila request):

- `message.reasoning` was a 1994-character string
- Our `injectReasoningIntoMessage` function set `message.content = '<reasoning>{1994chars}</reasoning>\n{original}'`
- `interceptReasoningResponse` returned `modified=true`
- We synthesized `new Response(JSON.stringify(body), { headers: response.headers })` and returned to LangChain

### Smoking gun #2: tags don't survive into LangChain's message

The diagnostic captured AFTER `model.invoke()` returns:

```
additionalKwargsKeys: ["function_call", "tool_calls"]   ← no reasoning key
hasReasoningTagsInContent: false                          ← no <reasoning> in content
hasReasoningInKwargs: false
rawContent: "Lila has been scrolling porn..."             ← starts with leaked planning prose
                                                          ← no <reasoning> tag prefix
```

`rawContent` comes from `response.content` (LangChain message). It does NOT have the `<reasoning>` tags we injected. They were stripped or bypassed somewhere in the LangChain → openai-client → response-parsing pipeline.

### OpenRouter generation log confirms model side is fine

`gen-1777093269-u0spcMQFFufj48uP1xsg`:

```json
{
  "streamed": true,
  "native_tokens_reasoning": 374,
  "native_tokens_completion": 580,
  "provider_name": "Parasail",
  "user_agent": "langchainjs-openai/1.0.0 ((node/v25.9.0; linux; x64))",
  ...
}
```

OpenRouter received reasoning content from the model. The leak is between OpenRouter's response and our diagnostic capture.

### Reasoning-extraction rate by model (last 14 days, prod)

| Model                   | hasReasoningTagsInContent rate |
| ----------------------- | ------------------------------ |
| `z-ai/glm-4.7`          | 16/18 = 88.9%                  |
| `z-ai/glm-4.5-air:free` | 19/19 = 100%                   |
| `z-ai/glm-5.1`          | 4/4 = 100%                     |
| `google/gemma-4-31b-it` | 3/4 = 75%                      |

**Per the user-feedback correction in the TL;DR**: this 88.9% IS the actual successful-extraction rate on GLM-4.7 (those are the cases where `/inspect` shows reasoning correctly). The remaining 11.1% is the intermittent failure — those are the requests where the interceptor extracts and injects, but the tags don't survive to `rawContent` capture.

**Gemma 4 ALSO supports reasoning** (`reasoning` in OpenRouter `supported_parameters` for both `google/gemma-4-31b-it` and the `:free` variant — verified 2026-04-25). So its 3/4 = 75% rate is genuine intermittent-failure data, not noise from a non-reasoning model. Sample size is too small to draw a strong rate estimate, but the fact that we see the failure on a non-GLM model **suggests this isn't GLM-specific** — it's a cross-model intermittent failure in our extraction pipeline. That refutes the "GLM-4.7-specific quirk" framing and points more strongly at H3/H4 (something in the response-handling path that's structurally different on a subset of requests).

The other GLM models showing 100% rates over very small samples (4 and 19 requests) may just not have hit the failing condition yet. Need more data accumulation before drawing per-model conclusions.

Re-run anytime: `pnpm ops run --env prod --force tsx scripts/src/glm47-reasoning-rate.ts`

## Hypothesis space (ordered by likelihood — REVISED for intermittent failure)

The bug is **intermittent** (happens ~11% of the time, not 100%). This rules out hypotheses that would produce universal failure and promotes ones that depend on per-request conditions.

### H3 (PROMOTED): Streaming-related path bypasses or strips our injection on a subset of requests

Now the leading hypothesis. OpenRouter's generation log shows `streamed: true` for the leaked request. Our interceptor's content-type check passes (`application/json`) and `reasoningInjected=true` fires — so the interceptor DID run. But there's likely a downstream code path that behaves differently when OpenRouter's underlying response involved streaming, even when delivered to us as application/json.

Possible mechanisms:

- The openai client's response parser may inspect a streaming-related header (e.g. `transfer-encoding: chunked`) and route to a stream-aware code path that reads from the original `response.body` stream rather than parsing our synthesized JSON body
- OpenRouter may populate `streamed: true` for a structurally-different response shape (e.g., trailing `[DONE]` chunks, or content + reasoning as separate top-level array elements rather than a single message object) that LangChain handles via a non-`message.content`-direct path

**Test**: re-run the diagnostic-rate query and segment by `provider_responses[0].provider_name` from OpenRouter's gen log. If the 11% failures all map to specific providers (e.g. Parasail vs DekaLLM) or specific request shapes, that's the discriminator.

**Better test**: add more request-shape diagnostic capture to `OpenRouterFetch` — log the response headers (especially `transfer-encoding`, `content-length`) for every request, plus a hash of the final `body.choices[0].message.content` after our injection. Cross-reference with diagnostic logs to find the 11% where `<reasoning>` tags vanished, see what's structurally different about those responses.

### H4 (PROMOTED): Two-pass response parsing where second pass overrides first under specific conditions

Could be intermittent if the second-pass triggers on certain response shapes (e.g., when reasoning length exceeds some threshold, when content/reasoning ratio is unusual, when refusal field is present, etc.).

**Test**: capture and log request/response shape characteristics on every request; cross-reference with the 11% failure cases for patterns.

### H1 (DEMOTED): openai client v6.34.0 always consumes original `response.body`

**Demoted because**: would produce 100% failure, not 11%. The fact that 89% of requests work correctly means the openai client IS reading our synthesized body in the success case. Something else makes 11% different.

Still possible if the client conditionally reads from one source vs another based on response characteristics — but that collapses to H3/H4 territory.

### H2 (DEMOTED): LangChain v1.4.4 always sanitizes XML-like tags

**Demoted because**: would produce 100% failure across the board. Real `<reasoning>` tags ARE making it to `rawContent` 89% of the time (and `/inspect` displays the extracted thinking content correctly), so there's no universal sanitizer running.

Still possible if sanitization is conditional on certain content shapes (e.g., very long content, specific characters in the reasoning) — but again collapses to "what triggers the conditional?" investigation.

### Open question: why do GLM-4.5-air and GLM-5.1 show 100%?

Could be:

- Sample size (only 19 and 4 requests respectively) — may just not have hit the failing condition yet
- A model-specific characteristic of GLM-4.7 that triggers the failing path more often
- A provider-routing characteristic (OpenRouter's `provider_responses[0].provider_name` for the leaked request was Parasail; check whether the other GLM models route through different providers consistently)

Verify with larger samples tomorrow as more traffic accumulates.

## Diagnostic infrastructure built during this investigation

All in `scripts/src/`, runnable via `pnpm ops run --env prod --force tsx scripts/src/<file>`:

- **`glm47-reasoning-rate.ts`** — rate of `hasReasoningTagsInContent` in diagnostic logs grouped by model + daily breakdown for GLM-4.7. Re-run anytime to track the rate over time.
- **`inspect-leaked-request.ts`** — pulls a specific request from `LlmDiagnosticLog` by requestId and prints all relevant fields. Hardcoded to `30a5af6d-6c29-458d-a6ed-9f817f1f6364` (the user's reported leak); change the requestId in the script for other investigations.
- **`openrouter-gen.ts`** — fetches OpenRouter's per-generation log via their API. Takes `GEN_ID` env var. Useful for cross-referencing what OpenRouter recorded vs. what we received.
- **`test-glm-reasoning-shape.ts`** — sends a fresh GLM-4.7 request (both streaming and non-streaming) and inspects the raw response shape. **Was queued but not run** when the user interrupted — running it would settle several hypotheses about what the API actually returns.

## Operational lesson learned (Railway log retention)

Railway DOES retain logs from past deployments. The `railway logs` command defaults to the most recent successful deployment, so logs from before a deploy event aren't visible by default.

**To pull from a past deployment**:

```bash
# 1. List recent deployments
railway deployment list --service <name> --environment production --limit 10

# 2. Pull logs from a specific deployment by ID
railway logs <DEPLOYMENT_ID> --service <name> --environment production --lines 5000 --filter "<query>"
```

For this investigation: the leaked request happened during deployment `c2f51bd9-cbe5-4b19-a998-270d946174d4` (beta.105), which was replaced by `3335a49a-b901-4455-9e62-278300e9e8a2` (beta.106) at 05:19 UTC. The `c2f51bd9` deployment's logs were still available via the explicit deployment-ID flag.

## Test plan to start with tomorrow

Ordered by ease and information value:

1. **Run `test-glm-reasoning-shape.ts`** locally (~2 cents) to see what GLM-4.7 actually returns in both streaming and non-streaming modes — `Object.keys(message)`, presence of `reasoning` in JSON body, presence of `delta.reasoning` in stream. This settles the API-side question definitively.

2. **Add an instrumentation log to `LLMInvoker.ts` after `model.invoke()` returns**:

   ```typescript
   logger.info(
     {
       contentPreview: response.content?.toString().substring(0, 200),
       contentHasReasoningTags: response.content?.toString().includes('<reasoning>'),
       additionalKwargsKeys: Object.keys(response.additional_kwargs ?? {}),
     },
     '[Debug] LangChain message after invoke'
   );
   ```

   Deploy, observe one reasoning-enabled request, see whether tags survived. Settles H1 vs H2.

3. **If H2 (LangChain sanitizer)**: experiment with non-XML wrapper format (`[REASONING_BEGIN]...[REASONING_END]`) in `OpenRouterFetch.injectReasoningIntoMessage`. If tags survive, switch the format and update `thinkingExtraction.ts` to recognize it.

4. **If H1 (openai client bypasses our body)**: investigate whether undici's Response can be constructed with a stream body that the openai client will actually consume, or pivot to a different interception mechanism (e.g., undici Dispatcher with `intercept` hook that mutates bytes in-stream).

## Backlog impact

This finding **reframes** the existing 🚨 Production Issues entry for "GLM-4.7 untagged thinking-leak" — that entry described the visible symptom; this doc describes the underlying cause. The two are linked but distinct:

- **Underlying bug**: reasoning content silently dropped between interceptor and LangChain message construction (this doc)
- **Visible symptom**: GLM-4.7 sometimes ALSO embeds planning prose in content directly, which becomes user-visible because we're not extracting reasoning correctly to mask it (the prior 🚨 entry, ~11% on GLM-4.7)

Once the underlying bug is fixed, the visible-symptom rate may or may not improve — the model embedding planning in content is a separate phenomenon, but the user-visible impact of it would be reduced (we'd at least be capturing the structured reasoning correctly for `/inspect` debugging).

## Related code paths

**Interceptor**:

- `services/ai-worker/src/services/modelFactory/OpenRouterFetch.ts` — full file
- `injectReasoningIntoMessage()` (lines ~93-151) — extracts `message.reasoning` and mutates `message.content`
- `interceptReasoningResponse()` (lines ~161-181) — iterates choices, calls injector
- `createOpenRouterFetch()` (lines ~239-309) — top-level fetch wrapper, content-type check at lines 287-289

**Consumer**:

- `services/ai-worker/src/services/ConversationalRAGService.ts:239` — `const rawContent = response.content as string`
- `services/ai-worker/src/services/LLMInvoker.ts:245` — `const response = await model.invoke(messages, invokeOptions)`

**Diagnostic**:

- `services/ai-worker/src/services/diagnostics/DiagnosticRecorders.ts:109-126` — `buildReasoningDebug` builds the field that surfaced the issue
- `services/ai-worker/src/utils/thinkingExtraction.ts:552` — `hasThinkingBlocks` checks for known reasoning tags including `<reasoning>`

## Why this has been "mostly working"

For non-reasoning requests, this bug has zero impact.

For reasoning requests, the system DOES work most of the time (~89% on GLM-4.7) — `/inspect` correctly shows the extracted reasoning, and users see clean responses with reasoning hidden per `showThinking: false`. The 11% intermittent failure has two visible symptoms:

1. **Lost audit data** — `/inspect` shows `thinkingContent: null` for those requests when reasoning content existed in the API response. Discoverable only by inspecting the failing request specifically and cross-referencing with OpenRouter's per-generation log.
2. **User-visible leak** — when the model ALSO embedded planning prose in `content` directly (which appears to be a separate GLM-4.7 phenomenon, not strictly correlated with the extraction failure), the user sees the planning prose because we're not masking it with the structured reasoning. This was the user-reported symptom that surfaced the entire investigation.

The two failure modes happen to combine in a way that makes the 11% rate user-visible. If the extraction failure happened on a request where the model behaved normally (clean `content`, all reasoning in the structured channel), the user wouldn't notice — they'd just see a clean response, missing only the audit-trail value of `/inspect`.

That's why this has gone unnoticed: no one was tracking the reasoning-extraction success rate quantitatively, and the user-visible leak was attributed to GLM-4.7 model quirks rather than upstream extraction loss. The PR #888 fix was designed for this leak class as if it were purely a model-emitted XML pattern — and it works for the tag-wrapped case — but the untagged-prose case (which this investigation revealed) goes through a different path that we don't extract from.
