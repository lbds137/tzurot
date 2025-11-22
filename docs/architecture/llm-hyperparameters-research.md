# LLM Hyperparameters Research

> **Research Date**: 2025-11-22
> **Purpose**: Identify advanced LLM parameters for database schema design
> **Source**: Gemini Code Assist consultation

## Executive Summary

Modern LLM APIs (especially reasoning models like OpenAI o1/o3 and Claude 3.7 Extended Thinking) have introduced parameters that are fundamentally incompatible with older schema designs. The key finding is that **provider-specific parameters create a sparse matrix problem** when stored as individual columns.

**Recommendation**: Use a **hybrid schema** with universal columns (temperature, model, etc.) plus a JSONB column for provider-specific advanced parameters.

## Critical New Parameters

### 1. Extended Thinking & Reasoning (New Frontier)

**OpenAI (o1/o3-mini)**:

- `reasoning_effort`: Enum (`low`, `medium`, `high`) - Controls how hard the model thinks
- `max_completion_tokens`: **Critical** - Replaces `max_tokens` for reasoning models (includes both reasoning tokens and output tokens)

**Anthropic (Claude 3.7 Sonnet Extended Thinking)**:

- `thinking`: Complex object (not a scalar)
  - `type`: "enabled" or "disabled"
  - `budget_tokens`: Integer (1024 to 10000+) - Limits the "inner monologue"
- **Constraint**: When `thinking` is enabled, `temperature` **must** be `1.0` - Application logic must enforce this override

**Google (Gemini 2.0/3.0 Pro - Experimental)**:

- `thinking_level`: Controls depth of reasoning (similar to OpenAI's `reasoning_effort`)
  - Values likely: `low`, `medium`, `high` (or numeric scale)
  - **Note**: Cutting-edge feature - check Google's latest API docs for exact parameter structure and availability

### 2. Advanced Sampling (OpenRouter / Open Source)

Beyond standard `temperature` and `top_p`:

- **`min_p`**: **Highly recommended** - Removes tokens less likely than a percentage of the most likely token (superior to `top_p` for creativity without going "off the rails")
- `top_a`: Similar to `min_p`, removes tokens depending on probability of highest token
- `top_k`: Already in our schema - OpenAI ignores it, Anthropic/Gemini rely on it heavily
- `typical_p`: Distinct sampling method for open-source models (balances surprise and coherence)

### 3. Structured Outputs & Schemas

**For Discord bot actions** (e.g., `/roll`, `/search`):

- `json_schema` (OpenAI/OpenRouter): Within `response_format`, pass strict JSON schema to force valid JSON output
- `tool_choice`: `auto`, `none`, or `required` - Control when personalities use tools (like searching conversation history)

### 4. Safety & Content Filtering

**Google Gemini**:

- `safety_settings`: Array of objects mapping categories to thresholds
  - Categories: `HARASSMENT`, `HATE_SPEECH`, `SEXUALLY_EXPLICIT`, `DANGEROUS_CONTENT`
  - Thresholds: `BLOCK_NONE`, `BLOCK_ONLY_HIGH`, etc.

**OpenAI**:

- `modalities`: For GPT-4o-Audio, specify `["text", "audio"]`

### 5. Context & Caching (Cost & Speed)

**Anthropic Prompt Caching**:

- Not a distinct parameter, but implemented via `breakpoints` in message array
- Potential config flag: `use_cache` (boolean) - If true, inject cache control headers to save 90% on input costs for long histories

## Parameter Comparison by Provider

| Parameter Category | OpenAI (GPT-4o/o1)                  | Anthropic (Claude)              | Google (Gemini)                           | OpenRouter (Llama/Mistral)               |
| :----------------- | :---------------------------------- | :------------------------------ | :---------------------------------------- | :--------------------------------------- |
| **Thinking**       | `reasoning_effort` (enum)           | `budget_tokens` (int)           | `thinking_level` (enum/int, experimental) | Varies (DeepSeek R1 uses generic params) |
| **Token Limits**   | `max_completion_tokens`             | `max_tokens`                    | `max_output_tokens`                       | `max_tokens`                             |
| **Sampling**       | `temperature`, `top_p`              | `temperature`, `top_p`, `top_k` | `top_p`, `top_k`                          | **`min_p`**, `top_a`, `typical_p`        |
| **Safety**         | Server-side (mostly)                | Server-side                     | **`safety_settings`** (granular)          | Varies                                   |
| **Structure**      | `json_schema`, `strict`             | `tool_choice`                   | `response_mime_type`                      | `transforms` (OpenRouter specific)       |
| **Latency**        | `prediction` (speculative decoding) | N/A                             | N/A                                       | N/A                                      |

## The Sparse Matrix Problem

**Problem**: If we add columns for `min_p`, `thinking_budget`, `safety_threshold_harassment`, etc., we'll have a massive table full of `NULL` values because:

- Gemini doesn't use `min_p`
- OpenAI doesn't use `safety_settings`
- Only reasoning models use `thinking` parameters
- Open-source models have unique parameters like `typical_p`

**Example of what NOT to do**:

```sql
ALTER TABLE LlmConfig ADD COLUMN min_p DECIMAL;           -- Only used by OpenRouter
ALTER TABLE LlmConfig ADD COLUMN reasoning_effort TEXT;  -- Only used by OpenAI o1/o3
ALTER TABLE LlmConfig ADD COLUMN thinking_budget INT;    -- Only used by Claude 3.7
ALTER TABLE LlmConfig ADD COLUMN safety_harassment TEXT; -- Only used by Gemini
-- ... results in 50+ columns with mostly NULL values
```

## Recommended Solution: Hybrid Schema

### Keep Universal Columns

**Standard columns** (for indexing and easy querying):

- `id` (PK)
- `personalityId` (FK)
- `provider` (enum: openai, anthropic, google, openrouter)
- `model` (varchar)
- `visionModel` (varchar, nullable)
- `temperature` (decimal)
- `topP` (decimal, nullable)
- `maxTokens` (int, nullable)

### Add JSONB Column for Advanced Parameters

**New column**:

- `advancedParameters` (JSONB) - Provider-specific and advanced settings

### Why This Works

1. **Querying**: Still can query universal traits: `SELECT * FROM LlmConfig WHERE provider = 'anthropic'`
2. **Flexibility**: When providers release new parameters, no database migration needed - just update application logic
3. **Validation**: Use Zod in TypeScript to validate JSON blob structure based on `provider` column
4. **Performance**: JSONB is indexed and queryable in PostgreSQL

### Example JSONB Payloads

**Claude 3.7 Extended Thinking**:

```json
{
  "topK": 40,
  "thinking": {
    "type": "enabled",
    "budgetTokens": 4000
  },
  "cacheControl": true
}
```

**OpenRouter Llama 3**:

```json
{
  "minP": 0.05,
  "repetitionPenalty": 1.1,
  "transforms": ["middle-out"]
}
```

**OpenAI o1**:

```json
{
  "reasoningEffort": "high",
  "maxCompletionTokens": 8000
}
```

**Google Gemini**:

```json
{
  "topK": 40,
  "safetySettings": [
    {
      "category": "HARM_CATEGORY_HARASSMENT",
      "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    }
  ]
}
```

## Migration Path

### Current LlmConfig Columns (to keep)

- `model`
- `visionModel`
- `temperature`
- `topP`
- `maxTokens`
- `memoryScoreThreshold`
- `memoryLimit`
- `maxConversationHistory`

### Current LlmConfig Columns (to move to JSONB)

- `topK` → `advancedParameters.topK`
- `frequencyPenalty` → `advancedParameters.frequencyPenalty`
- `presencePenalty` → `advancedParameters.presencePenalty`
- `repetitionPenalty` → `advancedParameters.repetitionPenalty`
- `stop` → `advancedParameters.stop`
- `seed` → `advancedParameters.seed`
- `logitBias` → `advancedParameters.logitBias`
- `responseFormat` → `advancedParameters.responseFormat`
- `streamResponse` → `advancedParameters.streamResponse`
- `systemFingerprint` → `advancedParameters.systemFingerprint`

### New Parameters (add to JSONB)

- `advancedParameters.reasoningEffort` (OpenAI o1/o3)
- `advancedParameters.maxCompletionTokens` (OpenAI reasoning models)
- `advancedParameters.thinking.type` (Claude 3.7)
- `advancedParameters.thinking.budgetTokens` (Claude 3.7)
- `advancedParameters.minP` (OpenRouter/open-source)
- `advancedParameters.topA` (OpenRouter/open-source)
- `advancedParameters.typicalP` (OpenRouter/open-source)
- `advancedParameters.safetySettings` (Gemini)
- `advancedParameters.jsonSchema` (OpenAI/OpenRouter)
- `advancedParameters.toolChoice` (all providers)
- `advancedParameters.cacheControl` (Anthropic)

## Implementation Notes

### Application Layer Validation

Use Zod schemas to validate `advancedParameters` based on provider:

```typescript
const OpenAIAdvancedParamsSchema = z.object({
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  maxCompletionTokens: z.number().int().positive().optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  // ...
});

const AnthropicAdvancedParamsSchema = z.object({
  topK: z.number().int().positive().optional(),
  thinking: z
    .object({
      type: z.enum(['enabled', 'disabled']),
      budgetTokens: z.number().int().min(1024).max(10000),
    })
    .optional(),
  cacheControl: z.boolean().optional(),
  // ...
});
```

### Business Logic Constraints

Some parameters have interdependencies:

- **Claude 3.7 Extended Thinking**: If `thinking.type === "enabled"`, then `temperature` **must** be `1.0`
- **OpenAI Reasoning Models**: Use `maxCompletionTokens` instead of `maxTokens`

These constraints should be enforced in application logic, not database constraints.

## References

- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Anthropic Claude API](https://docs.anthropic.com/en/api/messages)
- [Google Gemini API](https://ai.google.dev/api)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- Standard practice: LangChain, LiteLLM use JSONB for provider-specific parameters
