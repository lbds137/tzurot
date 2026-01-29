# Reasoning Model Formats Reference

> **Last Updated**: 2026-01-29
> **Version**: v3.0.0-beta.57

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

**OpenRouter Format:**

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The answer is 42.",
        "reasoning": "Let me think about this step by step..."
      }
    }
  ]
}
```

**Models using this format:**

- `deepseek/deepseek-r1` - Uses `message.reasoning` field
- Claude Extended Thinking - Uses `reasoning_details` array

**Challenge:** The OpenAI SDK strips unknown fields like `reasoning` before LangChain can preserve them. Tzurot solves this by intercepting the response in a custom fetch wrapper and injecting the reasoning into the content with `<reasoning>` tags.

**Relevant code:**

- `services/ai-worker/src/services/ModelFactory.ts` - `injectReasoningIntoContent()`

### 2. Inline Tags

Many models embed their reasoning directly in the content using XML-like tags.

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
    "effort": "medium", // low, medium, high, xhigh
    "enabled": true,
    "exclude": false // If true, reasoning is generated but not returned
  }
}
```

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

1. **Request** - `ModelFactory` sets `include_reasoning: true` in the OpenRouter request (via custom fetch)

2. **Response Interception** - Custom fetch intercepts the response:
   - Extracts `message.reasoning` if present
   - Injects it into `message.content` with `<reasoning>` tags
   - Returns modified response to LangChain

3. **Content Extraction** - `thinkingExtraction.ts` processes the content:
   - Extracts all thinking tag patterns
   - Separates thinking from visible content
   - Returns both for independent handling

4. **Result Building** - `GenerationStep` includes in result metadata:
   - `thinkingContent` - The extracted reasoning
   - `showThinking` - From the user's resolved LLM config

5. **Discord Display** - `DiscordResponseSender` checks:
   - If `showThinking === true` AND `thinkingContent` exists
   - Sends thinking as spoiler message before main response

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
  }
}
```

**Key diagnostic fields:**

- `thinkingExtracted` - Whether thinking was found and extracted
- `thinkingContent` - The actual thinking text (may be long)
- `showThinking` - Whether display is enabled

---

## Adding Support for New Models

1. **API-Level Reasoning** - If a new model returns reasoning in a non-standard field:
   - Update `injectReasoningIntoContent()` in `ModelFactory.ts`
   - Check for the new field name and inject with `<reasoning>` tags

2. **Inline Tags** - If a model uses a new tag format:
   - Add the pattern to `THINKING_PATTERNS` in `thinkingExtraction.ts`
   - Add to `UNCLOSED_TAG_PATTERN` if needed

---

## References

- [OpenRouter Reasoning Tokens Guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- `services/ai-worker/src/services/ModelFactory.ts`
- `services/ai-worker/src/utils/thinkingExtraction.ts`
- `services/ai-worker/src/utils/reasoningModelUtils.ts`
- `services/bot-client/src/services/DiscordResponseSender.ts`
