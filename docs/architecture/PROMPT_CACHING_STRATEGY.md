# Prompt Caching Strategy

**Date**: 2025-01-27
**Status**: Proposed
**Author**: Architecture Review

## Executive Summary

Prompt caching can significantly reduce API costs by caching static portions of prompts that don't change between requests. For Tzurot, this means caching personality definitions, system prompts, and user personas - which make up ~60-80% of each prompt but rarely change.

**Estimated Cost Savings**: 50-75% reduction in API costs for ongoing conversations.

## Current Situation

### Prompt Structure (from `ConversationalRAGService.ts`)

Every API call sends:

```
1. Personality system prompt (~500-2000 chars) ← CACHEABLE
2. Personality character fields (~500-3500 chars) ← CACHEABLE
3. User persona (~100-300 chars) ← CACHEABLE (per user)
4. LTM memories (~1000-3000 chars) ← NOT CACHEABLE (changes frequently)
5. Current date/time (~60 chars) ← NOT CACHEABLE (changes constantly)
6. STM conversation history (variable) ← NOT CACHEABLE (changes each turn)
7. Current user message (variable) ← NOT CACHEABLE
```

**Total prompt size**: ~5,000-15,000 characters per request
**Cacheable portion**: ~1,100-5,800 characters (40-80% of prompt)

### Cost Impact

Example with Claude Sonnet 4.5 on OpenRouter:

- Input: $3.00 per 1M tokens (~4 chars/token = ~250k chars)
- Cached input: $0.30 per 1M tokens (90% discount!)

For a typical conversation with 10 turns:

- **Without caching**: 10 turns × 10,000 chars = 100,000 chars = $0.75
- **With caching**: 1× 5,000 chars (full) + 9× 5,000 chars (cached) = $0.30 + $0.07 = $0.37
- **Savings**: $0.38 (50% reduction)

## Provider Support

### Anthropic Claude (via OpenRouter)

**Feature**: Prompt Caching
**Launched**: August 2024
**Pricing**: 90% discount on cached tokens

**How it works**:

- Specify cache breakpoints with `cache_control: { type: "ephemeral" }`
- Cache persists for 5 minutes
- Works with system messages and prefixed conversation history

**Implementation**:

```typescript
{
  role: "system",
  content: personalityPrompt,
  cache_control: { type: "ephemeral" }
}
```

**Limitations**:

- Minimum cacheable size: 1024 tokens (~4096 chars)
- Cache TTL: 5 minutes
- Only works with Claude models

**Status**: ✅ Available via OpenRouter

### Google Gemini

**Feature**: Context Caching
**Launched**: May 2024
**Pricing**: 75% discount (1.5M → 2M free tier with caching)

**How it works**:

- Create cached content via API
- Reference cache token in subsequent requests
- Cache persists for configurable TTL (default: 1 hour)

**Implementation**:

```typescript
// Create cache
const cache = await genAI.createCachedContent({
  model: 'gemini-2.5-flash',
  systemInstruction: personalityPrompt,
  ttl: 3600, // 1 hour
});

// Use cache
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  cachedContent: cache.name,
});
```

**Limitations**:

- Minimum cacheable size: 32,000 tokens (~128,000 chars)
- Cache TTL: Up to 1 hour
- Requires separate API calls to manage cache

**Status**: ✅ Available via Google AI API (not OpenRouter)

### OpenAI GPT-4/4o

**Feature**: None officially documented
**Internal Optimization**: Likely some caching, but not exposed to users

**Status**: ❌ Not available

### OpenRouter (General)

**Caching Support**: Depends on underlying model

- Claude models: ✅ Supports prompt caching
- Gemini models: ❌ No caching (requires direct Gemini API)
- Other models: ❌ No caching

**Status**: ⚠️ Partial (Claude only)

## Proposed Implementation

### Phase 1: Anthropic Claude Caching (Quick Win)

**Target**: Claude models via OpenRouter
**Effort**: Low
**Impact**: High (we use Claude frequently)

**Strategy**:

1. Mark personality system prompt with cache breakpoint
2. LangChain should handle this automatically if we pass the right metadata

**Code changes**:

```typescript
// In ConversationalRAGService.buildFullSystemPrompt()
const systemMessage = new SystemMessage({
  content: fullSystemPrompt,
  additional_kwargs: {
    cache_control: { type: 'ephemeral' },
  },
});
```

**Expected savings**: 50-75% cost reduction for Claude conversations

### Phase 2: Gemini Context Caching (Medium Effort)

**Target**: Gemini models via direct API
**Effort**: Medium
**Impact**: Medium (Gemini is cheaper already)

**Strategy**:

1. Create cached content for personality on first use
2. Store cache token in memory/Redis (TTL: 1 hour)
3. Reuse cache for subsequent requests

**Code changes**:

```typescript
// New file: services/ai-worker/src/services/GeminiCacheManager.ts
class GeminiCacheManager {
  async getCachedPersonality(personalityId: string): Promise<string> {
    // Check Redis for existing cache token
    // If not found or expired, create new cached content
    // Return cache token
  }
}
```

**Expected savings**: 40-60% cost reduction for Gemini conversations

### Phase 3: Cache Management & Invalidation

**Problem**: How to invalidate cache when personality changes?

**Solution**: Cache versioning

- Include personality version/hash in cache key
- When personality updated, version changes → cache miss → new cache created
- Old cache expires naturally after TTL

**Implementation**:

```typescript
function getPersonalityCacheKey(personality: LoadedPersonality): string {
  const hash = hashString(
    personality.systemPrompt + personality.characterInfo + personality.personalityTraits
    // ... other cacheable fields
  );
  return `personality:${personality.id}:${hash}`;
}
```

## Cache Segmentation Strategy

### Static Content (High Cache Hit Rate)

**Content**:

- Personality system prompt
- Character info, traits, tone, likes/dislikes, goals, examples

**Cache Key**: `personality:${personalityId}:${version}`
**TTL**: 1 hour (Gemini) or 5 minutes (Claude)
**Expected Hit Rate**: 90%+ (only changes when personality edited)

### Semi-Static Content (Medium Cache Hit Rate)

**Content**:

- User persona

**Cache Key**: `persona:${userId}:${version}`
**TTL**: 1 hour
**Expected Hit Rate**: 70-80% (users rarely edit their persona)

### Dynamic Content (No Caching)

**Content**:

- LTM memories (change based on query relevance)
- Current date/time
- STM conversation history
- Current user message

**Cache**: None

## Implementation Priority

1. **Phase 1 (Week 1)**: Claude prompt caching via LangChain
   - Minimal code changes
   - Immediate 50-75% savings for Claude usage
   - Low risk

2. **Phase 2 (Week 2-3)**: Gemini context caching with cache manager
   - Moderate code changes
   - 40-60% savings for Gemini usage
   - Adds complexity (cache management)

3. **Phase 3 (Week 4)**: Cache invalidation and monitoring
   - Add cache metrics/logging
   - Implement cache versioning
   - Monitor cache hit rates

## Monitoring & Metrics

**Key Metrics**:

- Cache hit rate (% of requests using cache)
- Cache age (how long cache used before expiring)
- Cost savings (cached tokens × rate difference)
- Cache invalidation events

**Logging** (development mode):

```typescript
logger.debug('[CACHE] Personality cache hit', {
  personalityId,
  cacheAge: Date.now() - cacheCreatedAt,
  cachedTokens: estimatedTokens,
  estimatedSavings: cachedTokens * (inputRate - cachedRate),
});
```

## Risks & Mitigations

| Risk                                 | Impact | Mitigation                                |
| ------------------------------------ | ------ | ----------------------------------------- |
| Stale cache after personality update | Medium | Version-based cache keys, short TTL       |
| Cache overhead for single messages   | Low    | Only cache for conversations (2+ turns)   |
| Complexity in cache management       | Medium | Start with simple TTL-based expiration    |
| Provider cache format changes        | Low    | Abstract behind interface, test regularly |

## Alternative Approaches

### Approach: Semantic Caching

**Idea**: Cache based on semantic similarity of prompts, not exact match
**Benefit**: Higher cache hit rate across similar personalities
**Drawback**: Risk of incorrect responses, complex implementation
**Decision**: ❌ Not recommended (correctness > savings)

### Approach: Client-Side Caching

**Idea**: Cache prompts in Redis before sending to API
**Benefit**: No provider dependency
**Drawback**: Still pay for full prompt processing
**Decision**: ❌ Not cost-effective

## Conclusion

Prompt caching is **highly recommended** for Tzurot:

1. **Immediate value**: 50-75% cost reduction with minimal effort
2. **Low risk**: Caching is provider-supported and well-documented
3. **Scalability**: More critical as user base grows

**Recommended Timeline**:

- **This week**: Implement Claude prompt caching (Phase 1)
- **Next week**: Test in production, measure savings
- **Week 3-4**: Add Gemini caching if Gemini usage is significant

## References

- [Anthropic Prompt Caching Docs](https://docs.anthropic.com/en/docs/prompt-caching)
- [Google Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [LangChain Caching Guide](https://python.langchain.com/docs/modules/model_io/llms/llm_caching)
