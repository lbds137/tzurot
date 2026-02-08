# OpenRouter Free-Tier LLM Research

> **Date**: 2026-01-24
> **Source**: Gemini consultation (2025-11-26)
> **Status**: Active - models and rate limits evolve

## TL;DR

OpenRouter's `:free` suffix routes to volunteer/promotional providers with rate limits (50-1000 req/day depending on account funding). Key models: DeepSeek R1 (reasoning, Temp 0.6), Gemini 2.0 Flash (1M context), Llama 3.3 70B (creative, needs RP 1.1). Tool calling unreliable on free tier - use for pure text generation only. Funded accounts ($10+) get 20x higher limits.

## Rate Limits

| Account Type  | Daily Requests | Requests/Minute |
| ------------- | -------------- | --------------- |
| Unfunded      | 50             | 20              |
| Funded ($10+) | 1,000          | Higher          |

**Architectural implication**: Implement fallback chains across model families to maximize effective daily volume.

## Recommended Models & Configs

### DeepSeek R1 (Reasoning/Coding)

```json
{
  "model": "deepseek/deepseek-r1:free",
  "vision_model": "qwen/qwen2.5-vl-72b-instruct:free",
  "temperature": 0.6,
  "top_p": 0.95,
  "repetition_penalty": 1.02,
  "context_window_tokens": 65536
}
```

**Notes**: Temp 0.6 is optimal for CoT. Higher temps cause derailing. Low/no penalties to preserve "thinking" syntax.

### Gemini 2.0 Flash (Long Context)

```json
{
  "model": "google/gemini-2.0-flash-exp:free",
  "vision_model": "google/gemini-2.0-flash-exp:free",
  "temperature": 0.7,
  "top_p": 0.95,
  "top_k": 40,
  "repetition_penalty": 1.0,
  "context_window_tokens": 1048576
}
```

**Notes**: 1M context window unique in free tier. Good for document analysis. "-exp" may deprecate suddenly.

### Llama 3.3 70B (Creative/Roleplay)

```json
{
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "vision_model": "meta-llama/llama-3.2-11b-vision-instruct:free",
  "temperature": 0.9,
  "top_p": 1.0,
  "frequency_penalty": 0.1,
  "repetition_penalty": 1.1,
  "context_window_tokens": 128000
}
```

**Notes**: MUST use RP 1.1 - Llama 3 prone to phrase looping without it.

### Mistral Nemo (Fast Chat)

```json
{
  "model": "mistralai/mistral-nemo:free",
  "temperature": 0.7,
  "repetition_penalty": 1.02,
  "context_window_tokens": 128000
}
```

**Notes**: Ideal "default" - 12B params balances speed/quality, less likely to hit rate limits.

### Fallback Chain

1. `google/gemini-2.0-flash-lite-preview-02-05:free` - Most reliable
2. `tngtech/tng-r1t-chimera:free` - Best roleplay quality
3. `meta-llama/llama-3.1-8b-instruct:free` - Always available "cockroach"

## Key Constraints

| Model        | Tool Calling  | Notes              |
| ------------ | ------------- | ------------------ |
| DeepSeek R1  | ❌ Unreliable | 404 errors common  |
| Gemini Flash | ✅ Works      | Better than others |
| Llama 3.3    | ❌ Unreliable | Use for pure text  |

**Agentic profiles** requiring tool use should fall back to paid tiers or "thinking" models that output code.

## Actionable Items

- See BACKLOG.md "Free-Tier Model Strategy" section
- Consider implementing rate-limit tracking with automatic model switching
