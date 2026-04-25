# LangChain reasoning extraction silently drops content (investigation)

> **Date**: 2026-04-25
> **Source**: User-reported GLM-4.7 leak in inspect log → multi-hour debug session
> **Status**: Active investigation — bug isolated, root cause hypothesized, fix not yet implemented

## TL;DR (read first thing)

**Our `OpenRouterFetch` interceptor extracts `message.reasoning` from API responses and injects `<reasoning>...</reasoning>` tags into `message.content` BEFORE returning the Response to LangChain. The interceptor runs successfully (~89%+ of GLM requests). But by the time `model.invoke()` returns and we read `response.content`, the `<reasoning>` tags are gone.** Something between our interceptor's `new Response(JSON.stringify(body), ...)` and LangChain's eventual `BaseMessage.content` is stripping or bypassing our injected tags.

This means **reasoning content is silently lost on every request that returns reasoning** — not just the visible "leak" cases. The visible leaks (~11% on GLM-4.7) are the subset where the model ALSO embedded planning prose in `content` directly; the silent loss happens 100% of the time the model returns reasoning.

The user's perception that "leaks are happening more often" was the visible symptom of an underlying bug that's been silently degrading our reasoning capture for an unknown duration.

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

The 88.9% rate on GLM-4.7 is misleading: it measures _tag presence in raw content as captured by the diagnostic_, but those tags are NOT making it to `response.content` (per the smoking guns above). The 88.9% measures something else — possibly `<reasoning>` tags emitted by the model itself in its visible content (a separate phenomenon). Needs verification.

Re-run anytime: `pnpm ops run --env prod --force tsx scripts/src/glm47-reasoning-rate.ts`

## Hypothesis space (ordered by likelihood)

### H1: openai client v6.34.0 consumes the original `response.body` stream, ignoring our synthesized JSON body

When we do `return new Response(JSON.stringify(body), { headers: response.headers })`, we hand back a Response object whose body is our serialized JSON. But the openai client may be using something like `response.body.getReader()` (the raw stream) on the **original** response that we already consumed via `clone.json()`. If so, our modifications would be on a discarded copy.

**Test**: instrument LLMInvoker to log `response.content.substring(0, 200)` immediately after `model.invoke()` returns. If the content lacks `<reasoning>` tags AND matches what the model originally returned in `delta.content` chunks (per OpenRouter's stream), this hypothesis is confirmed.

**Fix shape**: instead of returning `new Response(JSON.stringify(body), ...)`, mutate the original response's body somehow, or use a different mechanism (custom dispatcher, pre-request `messages` injection, etc.).

### H2: LangChain v1.4.4 has a content sanitizer that strips XML-like tags

Less likely but plausible — LangChain might run content through a sanitizer that removes unrecognized XML tags before constructing the BaseMessage.

**Test**: change the injection from `<reasoning>` to a non-XML format (e.g., `[REASONING_BEGIN]...[REASONING_END]`) and see if it survives. If it does, H2 is confirmed.

**Fix shape**: switch the interceptor's injection format to one that LangChain doesn't sanitize, or inject reasoning as a separate field that LangChain preserves (additional_kwargs?).

### H3: Streaming response bypasses our content-type check

The OpenRouter generation log shows `streamed: true`. Our `OpenRouterFetch.ts:287` skips interception for non-`application/json` content types. **HOWEVER** the interceptor logs (`Custom fetch received response ... contentType="application/json"` and `Inspecting response`) confirm the interceptor DID fire. So this hypothesis is partially refuted — at least for the leaked request, content-type was JSON. But OpenRouter's `streamed: true` may refer to upstream-only streaming (OpenRouter→provider hop), not their response to us.

Worth keeping the streaming-bypass hypothesis on the list as a separate latent bug — if any of our requests ever do return as `text/event-stream`, the interceptor would silently skip. We should add explicit handling or at least a warn-log.

### H4: Two-pass response parsing where second pass overrides first

The openai client might parse the response twice — once for usage metadata (using our modified body) and once for message content (using the raw stream). The second pass would overwrite our content modifications.

**Test**: similar to H1's test, but also check whether `usage` data in the diagnostic matches our modified body or the original.

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

For non-reasoning requests, this bug has zero impact (no reasoning to extract).

For reasoning requests, the silent loss has been invisible because:

- **`showThinking: false`** is the user's normal config — they never expected to see reasoning content in their replies
- **`/inspect` diagnostics** captured `thinkingContent: null`, but no one was systematically tracking the reasoning-extraction success rate until tonight
- **The visible "leak"** (~11% on GLM-4.7) was attributed to model quirks rather than upstream silent loss — the `GLM_47_META_PREAMBLE_PATTERN` (PR #888) was built to handle this as if it were a model-emitted XML pattern, when it might actually be a model-emitted prose pattern that we're not extracting

The system has been functioning correctly from the user's POV for the common case (clean responses with reasoning hidden), so the silent loss didn't surface as user-visible behavior. The audit value of `/inspect` was reduced (we couldn't see what the model was actually thinking), but no one was relying on that for production correctness.
