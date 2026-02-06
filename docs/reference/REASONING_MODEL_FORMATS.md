# Reasoning Model Formats Reference

> **Last Updated**: 2026-02-06
> **Version**: v3.0.0-beta.67

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

| Model                    | Response Field                      | Notes                                          |
| ------------------------ | ----------------------------------- | ---------------------------------------------- |
| DeepSeek R1              | `message.reasoning` (string)        | May also emit `<think>` tags in content        |
| Kimi K2/K2.5             | `message.reasoning` (string)        | Sometimes emits orphan `</think>` closing tags |
| Qwen QwQ                 | `message.reasoning` (string)        | Also emits `<think>` tags in content           |
| GLM-4.x                  | `message.reasoning` (string)        | Also emits `<think>` tags in content           |
| Claude Extended Thinking | `message.reasoning_details` (array) | `reasoning.text` with signatures               |
| Gemini 3                 | `message.reasoning_details` (array) | `reasoning.text` items                         |
| OpenAI o-series          | `message.reasoning_details` (array) | Often `reasoning.encrypted` (unreadable)       |
| xAI Grok                 | `message.reasoning_details` (array) | `reasoning.encrypted` format                   |

**Challenge:** LangChain's Chat Completions converter only extracts `function_call`, `tool_calls`, and `audio` from the response message. The `reasoning` and `reasoning_details` fields are silently dropped. Tzurot solves this with a custom fetch wrapper that intercepts the response and injects reasoning into `message.content` as `<reasoning>` tags before LangChain parses it.

**Relevant code:**

- `services/ai-worker/src/services/ModelFactory.ts` - `interceptReasoningResponse()`

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

**Supported tag patterns** (case-insensitive):
| Tag | Models |
|-----|--------|
| `<think>` | DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2 |
| `<thinking>` | Claude (when prompted), distilled models |
| `<ant_thinking>` | Legacy Anthropic format |
| `<reasoning>` | Various fine-tunes, injected API-level reasoning |
| `<thought>` | Legacy fine-tunes (Llama, Mistral) |
| `<reflection>` | Reflection AI |
| `<scratchpad>` | Research models |

**Relevant code:**

- `services/ai-worker/src/utils/thinkingExtraction.ts` - `extractThinkingBlocks()`

---

## Configuration

### Enabling Reasoning

To receive reasoning content from a model, configure your preset with:

```json
{
  "reasoning": {
    "effort": "medium",
    "enabled": true,
    "exclude": false
  }
}
```

**Effort levels:** `none`, `minimal`, `low`, `medium`, `high`, `xhigh`

**Constraint:** `effort` and `max_tokens` are mutually exclusive — use one or the other. When both are set, `effort` takes precedence.

The `reasoning.effort` parameter controls how much "thinking" the model does. Higher effort = more reasoning tokens = better quality but slower/more expensive.

### Displaying Thinking

To display the extracted thinking to users, enable `showThinking` in your preset:

```json
{
  "show_thinking": true
}
```

When enabled, thinking content appears as a collapsible Discord message before the main response:

```
💭 **Thinking:**
||[reasoning content hidden in spoiler]||

[Main response here]
```

---

## Pipeline Flow

1. **Request** - `ModelFactory` builds the `reasoning` param via `modelKwargs`, which LangChain passes through to the OpenRouter API as a top-level body key.

2. **Response Interception** - Custom fetch wrapper intercepts the API response:
   - Checks `message.reasoning` (string) and `message.reasoning_details` (array)
   - Injects extracted reasoning into `message.content` as `<reasoning>` tags
   - Returns modified response to LangChain (which would otherwise drop these fields)

3. **Content Extraction** - `ResponsePostProcessor` processes the content:
   - `extractApiReasoning()` checks `additional_kwargs.reasoning` (fallback path)
   - `extractThinkingBlocks()` extracts all inline tag patterns including `<reasoning>`
   - `mergeThinkingContent()` combines API-level and inline thinking
   - Returns `{ cleanedContent, thinkingContent }`

4. **Result Building** - `ConversationalRAGService` includes in RAG response:
   - `thinkingContent` - The extracted reasoning
   - `showThinking` - From the user's resolved LLM config

5. **Discord Display** - `DiscordResponseSender` checks:
   - If `showThinking === true` AND `thinkingContent` exists
   - Sends thinking as spoiler message before main response

---

## Edge Cases

### Models that return reasoning in content AND via API field

Some models (DeepSeek R1, QwQ, GLM-4.x) emit `<think>` tags in `message.content` even when `message.reasoning` is also populated. The pipeline handles this correctly:

- API-level reasoning is injected as `<reasoning>` tags by the custom fetch
- Inline `<think>` tags are also extracted
- `mergeThinkingContent()` deduplicates and combines both sources

### All-thinking responses (no visible content)

When a model spends its entire token budget on reasoning with nothing left for the actual response, `ResponsePostProcessor` logs a warning but returns empty visible content. The caller handles this as an empty response.

### Orphan closing tags

Kimi K2/K2.5 sometimes emits `</think>` without an opening tag. Handled by `ORPHAN_CLOSING_TAG_PATTERN` in `thinkingExtraction.ts`.

### Chimera model artifacts

Merged/fine-tuned models may emit stutter fragments before orphan closing tags. Handled by `CHIMERA_ARTIFACT_PATTERN`.

---

## Debugging

Use `/admin debug <message_id>` to see extraction details:

```json
{
  "postProcessing": {
    "thinkingExtracted": true,
    "thinkingContent": "...",
    "transformsApplied": ["thinking_extraction"]
  },
  "llmConfig": {
    "allParams": {
      "showThinking": true,
      "reasoning": { "effort": "medium", "enabled": true }
    }
  },
  "llmResponse": {
    "reasoningDebug": {
      "hasReasoningInKwargs": false,
      "hasReasoningDetails": false,
      "additionalKwargsKeys": ["function_call", "tool_calls"]
    }
  }
}
```

**Key diagnostic fields:**

- `thinkingExtracted` - Whether thinking was found and extracted
- `thinkingContent` - The actual thinking text (may be long)
- `showThinking` - Whether display is enabled
- `reasoningDebug` - Shows what LangChain preserved (note: API reasoning is injected into content by custom fetch, so these may be empty even when reasoning was captured)

---

## Adding Support for New Models

1. **API-Level Reasoning** - If a new model returns reasoning in a non-standard field:
   - Update `interceptReasoningResponse()` in `ModelFactory.ts`
   - Check for the new field name and inject with `<reasoning>` tags

2. **Inline Tags** - If a model uses a new tag format:
   - Add the pattern to `THINKING_PATTERNS` in `thinkingExtraction.ts`
   - Add to `UNCLOSED_TAG_PATTERN` if needed

---

## References

- [OpenRouter Reasoning Tokens Guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- `services/ai-worker/src/services/ModelFactory.ts`
- `services/ai-worker/src/services/ResponsePostProcessor.ts`
- `services/ai-worker/src/utils/thinkingExtraction.ts`
- `services/ai-worker/src/utils/reasoningModelUtils.ts`
- `services/bot-client/src/services/DiscordResponseSender.ts`
