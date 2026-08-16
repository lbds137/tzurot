# Reasoning Model Formats Reference

> **Last Updated**: 2026-07-28
> **Version**: v3.0.0-beta.182

This document explains how different AI models expose their reasoning/thinking process and how Tzurot extracts and displays this content.

---

## Overview

Reasoning models (also called "thinking models") show their internal deliberation process before producing a final answer. There are two main ways models expose this:

1. **API-Level Reasoning** - Reasoning in a separate response field
2. **Inline Tags** - Reasoning embedded in the content with XML-like tags

Tzurot supports both methods and can display the extracted thinking to users via Discord spoiler tags.

---

## Extraction Methods

### 1. API-Level Reasoning

Some providers return reasoning in a dedicated field separate from the main content.

**OpenRouter Response Formats:**

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The answer is 42.",
        "reasoning": "Let me think step by step..."
      }
    }
  ]
}
```

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The answer is 42.",
        "reasoning_details": [
          { "type": "reasoning.text", "text": "Step 1: ..." },
          { "type": "reasoning.summary", "summary": "High-level overview" }
        ]
      }
    }
  ]
}
```

**Models and their response format:**

| Model                    | Response Field                      | Notes                                                                                                                                 |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek R1              | `message.reasoning` (string)        | May also emit `<think>` tags in content                                                                                               |
| Kimi K2/K2.5             | `message.reasoning` (string)        | Sometimes emits orphan `</think>` closing tags; K2.6 emits reasoning as PLAIN TEXT in content (unhandled — run it with reasoning off) |
| Qwen QwQ                 | `message.reasoning` (string)        | Also emits `<think>` tags in content                                                                                                  |
| GLM-4.x                  | `message.reasoning` (string)        | Also emits `<think>` tags in content; each revision ships new tag vocabulary                                                          |
| z.ai direct API          | `message.reasoning_content`         | z.ai's own snake_case convention — read directly, no raw-response bridge (see below)                                                  |
| Claude Extended Thinking | `message.reasoning_details` (array) | `reasoning.text` with signatures                                                                                                      |
| Gemini 3                 | `message.reasoning_details` (array) | `reasoning.text` items                                                                                                                |
| OpenAI o-series          | `message.reasoning_details` (array) | Often `reasoning.encrypted` (unreadable)                                                                                              |
| xAI Grok                 | `message.reasoning_details` (array) | `reasoning.encrypted` format                                                                                                          |

**Challenge:** OpenRouter normalizes reasoning to `message.reasoning` (OpenAI's GPT-OSS canonical guidance), but LangChain's `@langchain/openai` chat-completions converter looks for `message.reasoning_content` (DeepSeek's legacy field name) and silently drops `message.reasoning`. Tracked in langchain-ai/langchain#32981 and #34706.

**Solution (post-parse extraction — no HTTP-body mutation):** `ModelFactory` sets `__includeRawResponse: true` on `ChatOpenAI` for OpenRouter models, which surfaces the complete raw API response at `additional_kwargs.__raw_response`. Immediately after `model.invoke()`, `LLMInvoker` calls `extractAndPopulateOpenRouterReasoning()`, which reads the raw message and populates the fields LangChain would have populated natively — `additional_kwargs.reasoning` and `response_metadata.reasoning_details` — then deletes `__raw_response` (raw payloads run 200–500KB and must not flow into BullMQ job results). An earlier design mutated the response body in a custom fetch wrapper before LangChain parsed it; that transport-layer approach is gone.

**z.ai is deliberately NOT bridged:** z.ai uses its own `reasoning_content` protocol, which `ResponsePostProcessor.extractApiReasoning()` reads directly, so `__includeRawResponse` is intentionally not set on the z.ai client.

**Relevant code:**

- `services/ai-worker/src/services/modelFactory/extractOpenRouterReasoning.ts` - `extractAndPopulateOpenRouterReasoning()`
- `services/ai-worker/src/services/LLMInvoker.ts` - the post-invoke call site
- `services/ai-worker/src/services/ModelFactory.ts` - `__includeRawResponse` (OpenRouter yes, z.ai no)

### 2. Inline Tags

Many models embed their reasoning directly in the content using XML-like tags. These can appear **in addition to** API-level reasoning — OpenRouter does NOT strip inline tags.

**Example:**

```
<think>
Let me analyze this problem...
First, I should consider...
</think>

The answer is 42.
```

**Supported tag patterns** (case-insensitive; source of truth: `KNOWN_THINKING_TAGS` in `thinkingExtraction.ts`):

| Tag                    | Models                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `<think>`              | DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2                     |
| `<thinking>`           | Claude (when prompted), distilled models                    |
| `<ant_thinking>`       | Legacy Anthropic format                                     |
| `<reasoning>`          | Some fine-tuned models                                      |
| `<thought>`            | Legacy fine-tunes (Llama, Mistral)                          |
| `<reflection>`         | Reflection AI                                               |
| `<scratchpad>`         | Legacy research models                                      |
| `<character_analysis>` | GLM 4.5 Air (internal chain-of-thought / response planning) |
| `<understanding>`      | GLM 4.5 Air (observed at thinking level `medium`)           |

**Relevant code:**

- `services/ai-worker/src/utils/thinkingExtraction.ts` - `extractThinkingBlocks()`

---

## Configuration

### Enabling Reasoning

To receive reasoning content from a model, set the canonical thinking level on your preset:

```json
{
  "thinking": "medium"
}
```

**Levels:** `off`, `minimal`, `low`, `medium`, `high`, `max`

**Absent is not `off`.** Omitting `thinking` sends nothing and takes the provider's own default; `"off"` explicitly asks the provider to disable reasoning.

The level is translated per provider at request-build time by `buildThinkingKwargs` in `services/ai-worker/src/services/modelFactory/thinkingTranslation.ts` — the single module that owns the translation table:

| canonical       | OpenRouter                       | z.ai-direct                                                   |
| --------------- | -------------------------------- | ------------------------------------------------------------- |
| _(absent)_      | nothing                          | nothing                                                       |
| `off`           | `reasoning: { effort: 'none' }`  | `thinking: { type: 'disabled' }`                              |
| any other level | `reasoning: { effort: <level> }` | `thinking: { type: 'enabled' }` + `reasoning_effort: <level>` |

z.ai does not read OpenRouter's `reasoning` object — it accepts unknown params and silently ignores them, which is why the split exists (and why the z.ai param filter is an allowlist: an untranslated param would be dropped on the floor with no error). `exclude` is never sent on either arm — both providers default to returning the trace, which `/inspect` depends on. Model caveat, live-probed: GLM-5.x treats `disabled` as best-effort (the model may think anyway); GLM-4.5-air honors it.

Higher levels mean more reasoning tokens: better quality, but slower and more expensive. When `max_tokens` is not set explicitly, the level also scales the response budget via `AI_DEFAULTS.REASONING_MODEL_MAX_TOKENS`.

Models with `supportsReasoning: false` in the catalog have reasoning params skipped entirely (with a warning) rather than sent and rejected.

### Save-Time Validation

Saving a preset whose thinking level the target model can't honor produces
**non-blocking warnings**, never a rejection. The gateway returns them on the
create/update response (`warnings: string[]`), and the preset dashboard renders
them in a separate ephemeral embed after the save lands.

| Case                                                                 | Warning                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `thinking: 'off'` on a model whose thinking is compulsory (glm-4.7)  | The `off` level will be ignored; the model keeps reasoning. |
| `thinking: 'off'` on a GLM-5.x model                                 | Disabling is best-effort — the model may still reason.      |
| Any non-`off` level on a model whose catalog entry lacks `reasoning` | The level will have no effect.                              |

Warnings are **advisory only**: capability data can be stale or briefly
unreachable, and a preset must never become unsaveable because a catalog lookup
had a bad day. Nothing is warned when the model can't be resolved at all — an
unresolvable model yields silence rather than a guess from its name.

The `thinkingOff` support level per z.ai model lives in `ZAI_MODEL_CATALOG`
(`packages/common-types/src/constants/ai.ts`), with each entry's calibration
(live-probed vs. read from z.ai's documentation) recorded in its comment.

**Not covered:** OpenRouter models that _require_ reasoning and reject an
explicit `off`. Nothing in OpenRouter's `/models` metadata marks a model as
reasoning-mandatory, so this is undetectable at save time and still surfaces as
a 400 at request time.

### Where the Thinking Goes

Extracted thinking is never rendered to users. It travels as `thinkingContent`
on the job-result metadata, is persisted with the assistant turn, and is
readable via `/inspect`.

---

## Pipeline Flow

1. **Request** - `ModelFactory.buildModelKwargs` merges the provider-appropriate thinking params from `buildThinkingKwargs()` (`modelFactory/thinkingTranslation.ts`) into `modelKwargs` — `reasoning: {...}` for OpenRouter, `thinking: {...}` + `reasoning_effort` for z.ai-direct — which LangChain passes through to the API as top-level body keys. On the z.ai route, `filterRestrictedParams` then applies the `ZAI_DIRECT_SUPPORTED_PARAMS` allowlist. OpenRouter-only extras (`transforms`, `route`, `verbosity`) are injected by the custom fetch wrapper (`OpenRouterFetch.ts`) on the request side.

2. **Raw-Response Capture** - For OpenRouter models, `__includeRawResponse: true` surfaces the complete raw API response at `additional_kwargs.__raw_response` after LangChain parses it. (The custom fetch no longer mutates response bodies for reasoning — its only response-side job is 400-recovery, below.)

3. **Post-Parse Extraction** - `LLMInvoker` calls `extractAndPopulateOpenRouterReasoning(response)` right after `model.invoke()`. In one in-place pass it:
   - populates `additional_kwargs.reasoning` (string) and `response_metadata.reasoning_details` (array) from the raw message
   - captures diagnostics into `response_metadata.openrouter` — actual upstream provider (Parasail, Chutes, …), `apiMessageKeys`, `apiReasoningLength`, and any provider error object attached to the choice
   - promotes reasoning to visible content when `content` is empty (some free-tier GLM variants put the whole response in `reasoning`)
   - deletes `__raw_response` (memory hygiene)

4. **Content Extraction** - `ResponsePostProcessor` processes the content:
   - `extractApiReasoning()` — field precedence: `additional_kwargs.reasoning` (OpenRouter/DeepSeek) → `additional_kwargs.reasoning_content` (z.ai) → `response_metadata.reasoning_details`
   - `extractThinkingBlocks()` extracts all inline tag patterns
   - `mergeThinkingContent()` combines API-level and inline thinking
   - Returns `{ cleanedContent, thinkingContent }`

5. **Result Building** - `ConversationalRAGService` includes `thinkingContent` (the extracted reasoning) in the RAG response.

6. **Persistence** - `SlotDeliveryService` saves `thinkingContent` with the assistant turn, so the trace outlives the 24h diagnostic window.

---

## Edge Cases

### Models that return reasoning in content AND via API field

Some models (DeepSeek R1, QwQ, GLM-4.x) emit `<think>` tags in `message.content` even when `message.reasoning` is also populated. The pipeline handles this correctly: API-level reasoning is extracted from the raw response, inline tags are extracted from content, and `mergeThinkingContent()` deduplicates and combines both sources.

### Reasoning-as-response (empty visible content)

When a model spends everything on `reasoning` and returns empty `content` (observed on free-tier GLM variants), `extractAndPopulateOpenRouterReasoning` **promotes the reasoning to visible content** instead of surfacing an empty reply. The kwargs/metadata population is skipped in that case so the actual response doesn't also appear in the audit trail as "thinking".

### HTTP 400 with usable content

Some free-tier providers (notably GLM variants) return HTTP 400 with valid `choices[0].message.content` — or the response hiding in `reasoning`/`reasoning_details`. LangChain would throw on the status code and lose the content; the custom fetch (`OpenRouterFetch.ts` `tryRecoverErrorContent`) synthesizes a 200, relocating reasoning-as-response into `content` when needed.

### Orphan closing tags

Kimi K2/K2.5 sometimes emits `</think>` without an opening tag. Handled by `ORPHAN_CLOSING_TAG_PATTERN` in `thinkingExtraction.ts`. (Kimi K2.6 instead emits reasoning as untagged plain text at the top of `content` — no handler exists for that; run K2.6 with reasoning off.)

### Chimera model artifacts

Merged/fine-tuned models may emit stutter fragments before orphan closing tags. Handled by `CHIMERA_ARTIFACT_PATTERN`.

### GLM fake user-message echo

GLM-4.5-Air has been observed improvising a reasoning channel by wrapping chain-of-thought in tags that mimic Tzurot's own prompt-assembly format (`<from_id>`/`<user>`/`<message>`), followed by the real response. A model-specific extractor runs as a first pass in `extractThinkingBlocks()`, anchored to absolute start-of-string so mid-response occurrences of the format are never stripped.

---

## Debugging

Use `/inspect <message_id>` to see extraction details:

```json
{
  "postProcessing": {
    "thinkingExtracted": true,
    "thinkingContent": "...",
    "transformsApplied": ["thinking_extraction"]
  },
  "llmConfig": {
    "allParams": {
      "thinking": "medium"
    }
  },
  "llmResponse": {
    "reasoningDebug": {
      "hasReasoningInKwargs": true,
      "reasoningKwargsLength": 1874,
      "hasReasoningDetails": false,
      "hasReasoningTagsInContent": false,
      "upstreamProvider": "Parasail",
      "apiMessageKeys": ["role", "content", "reasoning"],
      "apiReasoningLength": 1874
    }
  }
}
```

**Key diagnostic fields:**

- `thinkingExtracted` / `thinkingContent` - Whether thinking was found, and the text
- `hasReasoningInKwargs` / `reasoningKwargsLength` - Whether `additional_kwargs.reasoning` was populated by the post-parse extractor
- `upstreamProvider` - The ACTUAL upstream provider from `__raw_response.provider` (LangChain hardcodes `model_provider: "openai"`, which is useless for incident segmentation)
- `apiMessageKeys` - Keys on the raw API message; distinguishes "model returned structured reasoning" (`reasoning` present) from "model embedded planning into content" (just `role`/`content`)
- `apiReasoningLength` - Raw `message.reasoning` length; non-zero here but nothing visible downstream means the extraction broke

---

## Adding Support for New Models

1. **API-Level Reasoning** - If a new model returns reasoning in a non-standard field:
   - OpenRouter-routed: extend `populateReasoningFields()` in `extractOpenRouterReasoning.ts`
   - Direct-API providers (like z.ai): add the field to `ResponsePostProcessor.extractApiReasoning()`'s precedence chain

2. **Inline Tags** - If a model uses a new tag format:
   - Add the tag name to `KNOWN_THINKING_TAGS` in `thinkingExtraction.ts` (patterns, unclosed-tag, and orphan-closing handling all derive from that one list)

---

## References

- [OpenRouter Reasoning Tokens Guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- `services/ai-worker/src/services/modelFactory/extractOpenRouterReasoning.ts`
- `services/ai-worker/src/services/modelFactory/OpenRouterFetch.ts`
- `services/ai-worker/src/services/LLMInvoker.ts`
- `services/ai-worker/src/services/ModelFactory.ts`
- `services/ai-worker/src/services/ResponsePostProcessor.ts`
- `services/ai-worker/src/utils/thinkingExtraction.ts`
- `services/bot-client/src/services/DiscordResponseSender.ts`
