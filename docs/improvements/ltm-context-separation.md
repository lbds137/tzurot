# Prompt Structure Redesign - XML Tags & Temporal Awareness

## Problem Statement

Multiple issues stem from our current markdown-based prompt structure:

1. **LTM Temporal Confusion**: LLM treats old memories as current conversation, responding to content from days/weeks ago as if it just happened
2. **Timestamp Blindness**: LLM ignores timestamps on messages and memories, not understanding temporal distance
3. **Response Prefix Leakage**: LLM learns the conversation history format (`PersonaName: [timestamp] message`) and echoes it in responses, requiring regex cleanup (`responseCleanup.ts`)
4. **Section Boundary Confusion**: LLM sometimes responds to referenced messages or participant descriptions instead of the actual current message

## Root Cause Analysis

**Why Markdown Fails**:

- Markdown headers (`##`) are interpreted as stylistic formatting within a continuous document
- LLMs see the entire prompt as one flowing narrative
- No hard boundaries between "reference data" and "respond to this"

**Why Timestamps Don't Work**:

- "Jan 15, 2025" and "Jan 30, 2025" look like text strings, not temporal distance
- LLMs don't naturally calculate "that was 2 weeks ago"
- All memories appear equally "present" in the context window

## Solution: XML Tags + Relative Time Deltas

### Key Insight (from Gemini Consultation, 2025-12-06)

> "XML tags (`<section>`) are treated by modern models (Claude 3, GPT-4, Llama 3) as hard semantic boundaries. This significantly reduces Section Boundary Confusion."

### The "Cognitive Container" Structure

```xml
<character_profile>
  <!-- Static identity - CACHEABLE -->
  <name>{{char_name}}</name>
  <personality>{{personality_traits}}</personality>
  <appearance>{{appearance}}</appearance>
</character_profile>

<current_situation>
  <!-- Dynamic but small -->
  <datetime_now>{{current_date_time}}</datetime_now>
  <location>{{discord_location}}</location>
  <participants>
    <active_speaker>{{user_persona_name}}</active_speaker>
  </participants>
</current_situation>

<memory_archive>
  <!-- EXPLICIT: These are PAST events -->
  <instruction>These are ARCHIVED HISTORICAL LOGS from past interactions. Do NOT treat them as happening now. Do NOT respond to this content directly.</instruction>
  <entry date="Jan 15, 2025" relative="2 weeks ago">
    {{memory_content}}
  </entry>
  <entry date="Dec 28, 2024" relative="1 month ago">
    {{memory_content}}
  </entry>
</memory_archive>

<contextual_references>
  <!-- Referenced messages from replies/links -->
  <ref author="{{author}}" time="{{timestamp}}" relative="{{time_delta}}">
    {{content}}
  </ref>
</contextual_references>

<conversation_history>
  <!-- Recent STM - what's been said -->
  <!-- Format TBD - may need different approach -->
</conversation_history>

<response_protocol>
  <!-- CRITICAL: Closest to generation = highest impact (recency bias) -->
  1. Respond ONLY to the latest message in the conversation.
  2. Use <memory_archive> for context about past events, not as something to respond to.
  3. OUTPUT FORMAT: Raw response text only.
     - INVALID: "{{char_name}}: [{{time}}] *waves*"
     - VALID: "*waves* Hello!"
  4. Do NOT output your name, timestamp, or colon prefix.
  5. Stay in character.
</response_protocol>
```

### Section Ordering (U-Shaped Attention)

LLMs pay most attention to the **beginning** and **end** of context:

1. **Top (Beginning)**: Identity & personality (who am I)
2. **Middle**: Memories, references, history (background data)
3. **Bottom (End)**: Current situation, output rules (highest impact)

### Relative Time Deltas (Application Layer)

Instead of raw timestamps, calculate the delta in code:

```typescript
// Before
formatMemoryTimestamp(doc.metadata.createdAt); // "Jan 15, 2025 10:30 AM"

// After
formatMemoryWithDelta(doc.metadata.createdAt);
// Returns: { absolute: "Jan 15, 2025", relative: "2 weeks ago" }
```

This makes temporal distance **visceral** rather than requiring the LLM to do math.

## Prompt Caching Opportunities

### OpenRouter + Anthropic Caching

Per [OpenRouter docs](https://openrouter.ai/docs/guides/best-practices/prompt-caching):

- **4 cache breakpoints** available with `cache_control`
- **5 minute TTL** (default), refreshed on use; 1-hour option available
- Best for **large static content** (character cards, personality data)
- Some reports of caching being less effective via OpenRouter than direct API

### What Can Be Cached

| Section                  | Cacheable? | Notes                              |
| ------------------------ | ---------- | ---------------------------------- |
| `<character_profile>`    | **Yes**    | Static per personality             |
| `<response_protocol>`    | **Yes**    | Static rules                       |
| `<current_situation>`    | No         | Changes every request (time, etc.) |
| `<memory_archive>`       | No         | Changes based on retrieval         |
| `<conversation_history>` | No         | Changes every request              |

### Implementation Approach

```typescript
// Potential structure with cache breakpoints
const systemPrompt = [
  { text: characterProfile, cache_control: { type: 'ephemeral' } },
  { text: responseProtocol, cache_control: { type: 'ephemeral' } },
  { text: currentSituation }, // Not cached
  { text: memoryArchive }, // Not cached
].join('\n');
```

### Model Considerations

- **Anthropic Claude**: Native cache_control support
- **OpenAI GPT-4**: Has similar caching, different API
- **Other models**: May not support caching at all

OpenRouter can route to different models, so caching implementation needs to be model-aware or best-effort.

## Files to Modify

### Core Prompt Building

1. **`PromptBuilder.ts`** (`services/ai-worker/src/services/`)
   - Restructure `buildFullSystemPrompt()` to use XML containers
   - Move response protocol to end of prompt
   - Add cache breakpoint markers for Anthropic models

2. **`MemoryFormatter.ts`** (`services/ai-worker/src/services/prompt/`)
   - Wrap in `<memory_archive>` with instruction
   - Add relative time delta to each memory entry
   - Calculate "X days/weeks/months ago"

3. **`EnvironmentFormatter.ts`** (`services/ai-worker/src/services/prompt/`)
   - Wrap in `<current_situation>` tags
   - Include datetime with proper emphasis

4. **`ParticipantFormatter.ts`** (`services/ai-worker/src/services/prompt/`)
   - Wrap participant info appropriately
   - Add `<active_speaker>` for group conversations

5. **`ReferencedMessageFormatter.ts`** (`services/ai-worker/src/services/`)
   - Wrap in `<contextual_references>` tags
   - Add relative time delta to references

### Supporting Changes

6. **`dateFormatting.ts`** (`packages/common-types/src/utils/`)
   - Add `formatRelativeTime()` function
   - Return both absolute and relative timestamps

7. **`responseCleanup.ts`** (`services/ai-worker/src/utils/`)
   - May be simplified if XML structure reduces prefix leakage
   - Keep as defensive fallback

### Optional: Stop Sequences

8. **`LLMInvoker.ts`** (`services/ai-worker/src/services/`)
   - Add stop sequences for `CharacterName:` and `[` to physically prevent prefix generation
   - Model-specific configuration

## Testing Plan

> ⚠️ **CRITICAL**: This is a fundamental change to how prompts are structured. Every aspect of LLM behavior depends on prompt quality. **Thorough testing is mandatory before any merge to develop.**

### Testing Priority

This change affects the core behavior of all AI responses. We need:

1. **100% unit test coverage** for all formatter changes
2. **Integration tests** verifying complete prompt assembly
3. **Behavioral tests** confirming XML structure is correct
4. **Regression tests** ensuring existing functionality isn't broken
5. **Manual testing** with real conversations before production rollout

### Unit Tests

1. **`MemoryFormatter.test.ts`** - New tests:
   - Verify XML wrapper is present
   - Verify instruction text is included
   - Verify relative time delta is calculated correctly
   - Test edge cases: "just now", "1 hour ago", "yesterday", "2 weeks ago", "3 months ago"

2. **`PromptBuilder.test.ts`** - New tests:
   - Verify XML structure in output
   - Verify section ordering (identity first, protocol last)
   - Verify response protocol contains output formatting rules
   - Test cache breakpoint markers (when targeting Anthropic)

3. **`EnvironmentFormatter.test.ts`** - New tests:
   - Verify `<current_situation>` wrapper
   - Verify datetime emphasis

4. **`ParticipantFormatter.test.ts`** - New tests:
   - Verify `<active_speaker>` for group conversations
   - Verify participant XML structure

5. **`ReferencedMessageFormatter.test.ts`** - New tests:
   - Verify `<contextual_references>` wrapper
   - Verify relative time in references

6. **`dateFormatting.test.ts`** - New tests:
   - `formatRelativeTime()` with various time deltas
   - Edge cases: future dates, invalid dates, timezone handling

### Integration Tests

7. **`PromptBuilder.integration.test.ts`** (new file in `services/ai-worker/src/services/`):
   - Full prompt assembly produces valid XML-like structure
   - All sections present in correct order (identity → memories → situation → protocol)
   - No unclosed tags or malformed structure
   - Character profile section contains expected personality data
   - Memory archive section correctly wraps retrieved memories
   - Response protocol is at END of prompt (critical for recency bias)
   - Relative time deltas are calculated correctly for test fixtures
   - Empty sections handled gracefully (no memories, no references, etc.)
   - Special characters in content don't break XML structure (quotes, angle brackets, etc.)

### Manual Testing Checklist

After deployment to development:

- [ ] LLM responds to current message, not old memories
- [ ] Timestamps are understood (ask "how long ago did X happen?")
- [ ] Response doesn't include `CharacterName: [timestamp]` prefix
- [ ] Roleplay asterisks still work correctly
- [ ] Group conversations correctly identify active speaker
- [ ] Referenced messages don't get confused with current message
- [ ] No regression in response quality

## Risk Assessment

### High-Impact Risks

| Risk                               | Likelihood | Impact | Mitigation                                                  |
| ---------------------------------- | ---------- | ------ | ----------------------------------------------------------- |
| XML confuses certain models        | Low        | High   | Test with all supported models before rollout               |
| Response quality degrades          | Medium     | High   | Extensive manual testing, rollback plan ready               |
| Prompt becomes too long            | Low        | Medium | XML tags add ~200 chars; monitor token counts               |
| Cache hit rate lower than expected | Medium     | Low    | Caching is Phase 4, optional; core feature works without it |

### Rollback Plan

If issues are detected after deployment:

1. Revert the commit on `develop`
2. Railway will auto-redeploy previous working version
3. Monitor logs for 15 minutes to confirm stability
4. Document what went wrong for next attempt

### Model Compatibility

XML tag interpretation varies by model. Testing priority:

1. **Claude 3.5 Sonnet** - Primary model, best XML understanding
2. **Claude 3 Haiku** - Guest mode fallback
3. **GPT-4o** - Alternative provider
4. **Gemini models** - May handle XML differently
5. **Llama/Mistral** - Lower priority, less predictable

## Rollout Strategy

### Phase 1: XML Wrappers (Low Risk) ✅ COMPLETE

1. ✅ Add XML wrappers around existing content
   - `<persona>` wraps character identity (at START for primacy effect)
   - `<current_situation>` wraps environment/datetime
   - `<participants>` wraps active users
   - `<memory_archive>` wraps LTM with historical instruction
   - `<contextual_references>` wraps referenced messages
   - `<protocol>` wraps system prompt (at END for recency bias)
2. ✅ Keep markdown headers inside wrappers initially
3. ✅ Test for regressions - all 3,249+ tests pass

### Phase 2: Relative Time Deltas ✅ COMPLETE

1. ✅ Implement `formatRelativeTimeDelta()` utility in dateFormatting.ts
2. ✅ Implement `formatTimestampWithDelta()` for combined format
3. ✅ Update MemoryFormatter to include deltas: `[Mon, Jan 15, 2025 — 2 weeks ago] content`
4. ✅ Update ReferencedMessageFormatter to include deltas
5. ✅ Add comprehensive tests for date formatting functions

### Phase 3: Response Protocol Relocation ✅ COMPLETE (with Phase 1)

1. ✅ Move output formatting rules to end of prompt (protocol section)
2. ✅ Split persona from protocol in PromptBuilder
3. ✅ Persona at START (primacy effect), Protocol at END (recency bias)

### Phase 4: Prompt Caching (Deferred)

1. Implement cache breakpoints for Anthropic models
2. Add model detection for cache support
3. Monitor cost savings

**Note**: Deferred to post-launch. Core functionality complete without caching.

## Related Documentation

- [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [Anthropic Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- Gemini consultation on 2025-12-06

## Success Metrics

1. **Prefix stripping rate**: Should decrease (fewer regex cleanups needed)
2. **Temporal accuracy**: LLM correctly distinguishes old vs new events
3. **Response relevance**: Responses address current message, not memories
4. **Cost savings**: If caching implemented, track cache hit rates

## Open Questions

1. Should conversation history also use XML, or keep as-is?
2. How to handle models that don't support stop sequences?
3. Is 5-minute cache TTL sufficient for our use case?
4. Should we A/B test XML vs markdown to measure improvement?
