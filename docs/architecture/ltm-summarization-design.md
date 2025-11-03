# LTM Summarization Design (Future Enhancement)

**Status:** DEFERRED - Not required for MVP
**Priority:** MEDIUM - Optimization, not critical
**Implement:** After production deployment stable

---

## Problem Statement

**Current:** Verbatim message storage in Qdrant

```
User: "hey there!!! 😊 *waves excitedly*"
Stored: "hey there!!! 😊 *waves excitedly*"
```

**Issues:**

- Roleplay formatting (_actions_, emojis) clutters semantic search
- Long conversations = large vectors (storage cost)
- Exact wording less useful than semantic meaning over time

**Shapes.inc Approach:**

- Separate summarizer LLM config
- Configurable summarizer system prompt
- Condensed memories without losing semantic meaning

---

## Design Goals

1. ✅ Preserve semantic meaning (what was discussed)
2. ✅ Remove roleplay formatting noise (_asterisks_, excessive emojis)
3. ✅ Reduce storage cost (shorter vectors)
4. ✅ Configurable per-personality (some might want verbatim)
5. ✅ Don't lose important details (names, facts, dates)

---

## Proposed Architecture

### Schema Addition

```prisma
model Personality {
  // ... existing fields ...

  // Memory management settings
  memoryEnabled Boolean @default(true) @map("memory_enabled")

  // NEW: Summarization settings
  memorySummarizationEnabled Boolean @default(false) @map("memory_summarization_enabled")
  summarizerLlmConfigId      String?  @map("summarizer_llm_config_id") @db.Uuid
  summarizerLlmConfig        LlmConfig? @relation("SummarizerConfig", fields: [summarizerLlmConfigId], references: [id], onDelete: SetNull)

  // Relationship to main LLM config
  defaultConfigLink PersonalityDefaultConfig?

  @@map("personalities")
}

model LlmConfig {
  // ... existing fields ...

  // Relations
  personalitiesUsingAsDefault PersonalityDefaultConfig[]
  personalitiesUsingAsSummarizer Personality[] @relation("SummarizerConfig")

  @@map("llm_configs")
}

model SystemPrompt {
  // ... existing fields ...

  // NEW: Prompt type
  promptType String @default("personality") @db.VarChar(50)
  // Types: 'personality', 'summarizer', 'system'

  @@index([promptType])
  @@map("system_prompts")
}
```

### Summarizer System Prompt Examples

**Default Summarizer Prompt:**

```
You are a memory summarizer. Your job is to extract the semantic meaning from conversations while removing formatting artifacts.

Guidelines:
- Remove roleplay formatting (*actions*, emojis)
- Preserve factual information (names, dates, places, events)
- Condense verbose exchanges into key points
- Maintain emotional context without the excessive formatting
- Focus on what was discussed, not how it was said

Input: "*waves excitedly* hey there!!! 😊 how are you doing today??? *bounces*"
Output: "User greeted enthusiastically and asked how I'm doing"

Input: "I went to the store yesterday and bought some apples 🍎 and oranges 🍊 for my kids"
Output: "User went shopping yesterday and bought apples and oranges for their children"

Now summarize the following conversation exchange:
```

**Personality-Specific Summarizer:**

```
You are summarizing memories for Lilith, a sarcastic AI personality.

Preserve:
- Technical discussions (code, programming concepts)
- User's skill level and learning progress
- Inside jokes and sarcasm
- Important personal facts

Remove:
- Excessive formatting
- Redundant greetings
- Filler words

Summarize concisely but don't lose nuance.
```

### Summarization Pipeline

```typescript
class MemorySummarizationService {
  /**
   * Summarize a conversation exchange before storing in LTM
   */
  async summarizeForMemory(
    personalityId: string,
    conversationExchange: {
      user: string;
      assistant: string;
      context?: string; // Previous messages for context
    }
  ): Promise<string> {
    // 1. Get personality's summarization config
    const personality = await prisma.personality.findUnique({
      where: { id: personalityId },
      include: {
        summarizerLlmConfig: true,
        summarizerSystemPrompt: true,
      },
    });

    // If summarization disabled, return verbatim
    if (!personality.memorySummarizationEnabled) {
      return `User: ${conversationExchange.user}\nAssistant: ${conversationExchange.assistant}`;
    }

    // 2. Build summarization prompt
    const systemPrompt = personality.summarizerSystemPrompt?.content || DEFAULT_SUMMARIZER_PROMPT;

    const userPrompt = `
Context (if relevant): ${conversationExchange.context || 'None'}

User message: ${conversationExchange.user}
Assistant response: ${conversationExchange.assistant}

Summarize this exchange into a concise memory that preserves meaning but removes formatting artifacts:
`;

    // 3. Use summarizer LLM config (or default to cheap model)
    const summarizerConfig = personality.summarizerLlmConfig || {
      model: 'anthropic/claude-haiku', // Cheap, fast model
      temperature: 0.3, // Low temperature for consistency
      maxTokens: 200, // Keep summaries concise
    };

    const model = createChatModel(summarizerConfig);

    // 4. Generate summary
    const response = await model.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    return response.content;
  }

  /**
   * Batch summarize multiple exchanges (for conversation end)
   */
  async summarizeConversation(
    personalityId: string,
    conversationHistory: ConversationMessage[]
  ): Promise<string[]> {
    const summaries: string[] = [];

    // Group messages into exchanges (user message + assistant response pairs)
    const exchanges = this.groupIntoExchanges(conversationHistory);

    for (const exchange of exchanges) {
      const summary = await this.summarizeForMemory(personalityId, {
        user: exchange.userMessage,
        assistant: exchange.assistantMessage,
        context: exchange.precedingContext,
      });

      summaries.push(summary);
    }

    return summaries;
  }

  private groupIntoExchanges(messages: ConversationMessage[]): Exchange[] {
    // Group consecutive user+assistant pairs
    const exchanges: Exchange[] = [];
    let currentExchange: Partial<Exchange> = {};

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        if (currentExchange.userMessage) {
          // Save previous exchange if complete
          if (currentExchange.assistantMessage) {
            exchanges.push(currentExchange as Exchange);
          }
          currentExchange = {};
        }
        currentExchange.userMessage = msg.content;
        currentExchange.precedingContext = messages
          .slice(Math.max(0, i - 3), i)
          .map(m => `${m.role}: ${m.content}`)
          .join('\n');
      } else if (msg.role === 'assistant') {
        currentExchange.assistantMessage = msg.content;
      }
    }

    // Add final exchange if complete
    if (currentExchange.userMessage && currentExchange.assistantMessage) {
      exchanges.push(currentExchange as Exchange);
    }

    return exchanges;
  }
}
```

### Integration with Memory Storage

```typescript
// In ConversationalRAGService or AIJobProcessor

async storeConversationMemories(
  personaId: string,
  personalityId: string,
  conversationHistory: ConversationMessage[]
): Promise<void> {
  // 1. Check if summarization enabled for this personality
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { memorySummarizationEnabled: true }
  });

  let memoryContent: string;

  if (personality.memorySummarizationEnabled) {
    // 2a. Summarize the conversation
    const summaries = await summarizationService.summarizeConversation(
      personalityId,
      conversationHistory
    );

    memoryContent = summaries.join('\n\n');

    logger.info(`Summarized ${conversationHistory.length} messages into ${summaries.length} memory summaries`);
  } else {
    // 2b. Store verbatim
    memoryContent = conversationHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
  }

  // 3. Store in Qdrant
  await memoryService.addMemory(
    personaId,
    memoryContent,
    {
      personalityId,
      interactionType: 'direct',
      createdAt: Date.now(),
      summarized: personality.memorySummarizationEnabled
    }
  );
}
```

---

## Configuration Examples

### Example 1: Verbose Personality (No Summarization)

```typescript
{
  personalityId: "lilith-uuid",
  name: "Lilith",
  memoryEnabled: true,
  memorySummarizationEnabled: false,  // Keep verbatim
  summarizerLlmConfigId: null
}
```

**Result:** Exact message content stored, including formatting

**Use Case:** Personalities where exact wording matters (poets, comedians, etc.)

### Example 2: Efficient Personality (Summarized)

```typescript
{
  personalityId: "workbot-uuid",
  name: "WorkBot",
  memoryEnabled: true,
  memorySummarizationEnabled: true,   // Enable summarization
  summarizerLlmConfigId: "haiku-config-uuid"
}

// Linked summarizer config:
{
  id: "haiku-config-uuid",
  model: "anthropic/claude-haiku",
  temperature: 0.3,
  maxTokens: 150
}
```

**Result:** Condensed semantic summaries

**Use Case:** Information-focused personalities where storage efficiency matters

---

## Storage Comparison

### Verbatim Storage

```
Input (273 chars):
"*bounces excitedly* omg omg omg!!! 😊✨ I just finished that Rust project we talked about last week!!! 🦀 *does a little dance* The borrow checker finally makes sense now lol 😅 thank you so much for all your help!!! *hugs*"

Stored: [same 273 chars]
```

### Summarized Storage

```
Input: [same 273 chars]

Summarized (89 chars):
"User completed the Rust project from last week and now understands the borrow checker."

Reduction: 67% smaller
```

**At Scale:**

- 1000 messages verbatim: ~273 KB
- 1000 messages summarized: ~89 KB
- **Savings: ~184 KB per 1000 messages**

For vector embeddings (1536 dimensions):

- Verbatim: More vectors needed for long text
- Summarized: Denser semantic meaning in fewer vectors

---

## Slash Commands (Future)

```typescript
// User configures their preferences
/memory settings summarization:enabled
/memory settings summarization:disabled

// Personality owners configure
/personality @Lilith memory summarization:enabled
/personality @Lilith memory summarizer-model:claude-haiku

// View current settings
/memory status
// Shows:
// - Memory enabled: Yes
// - Summarization: Enabled
// - Summarizer model: claude-haiku
// - Storage used: 1.2 MB (estimated)
```

---

## Implementation Checklist (DEFERRED)

- [ ] Add `memorySummarizationEnabled` to Personality model
- [ ] Add `summarizerLlmConfigId` relation
- [ ] Add `promptType` to SystemPrompt model
- [ ] Create default summarizer system prompts
- [ ] Implement `MemorySummarizationService`
- [ ] Update memory storage pipeline to use summarization
- [ ] Add slash commands for configuration
- [ ] Migrate existing personalities (default: disabled)
- [ ] Test with various conversation styles
- [ ] Monitor storage savings

---

## Migration Strategy (When Implemented)

### Existing Memories

**Option 1:** Leave as-is (verbatim), only summarize new memories

**Option 2:** Batch re-summarize existing memories

- Pro: Consistent format, storage savings
- Con: Expensive (LLM calls for all existing memories)
- Recommendation: Only if storage becomes problem

### User Communication

When enabling:

```
"Lilith will now store conversation memories in a more efficient format.
This helps with storage and improves recall of important details.
Your conversation history quality won't change - just more focused!"
```

---

## When to Implement

**Triggers:**

1. Storage costs become significant (>$X/month for Qdrant)
2. Users complain about irrelevant memory retrieval (too much noise)
3. Vector search quality degrades from verbose memories
4. Users explicitly request it

**Effort:** ~6-8 hours

- Schema changes: 1 hour
- Summarization service: 3 hours
- Integration: 2 hours
- Testing: 2 hours

**Priority:** LOW - Works fine without it for MVP

---

## Alternative: Hybrid Approach

Store BOTH verbatim and summarized:

```typescript
{
  content: "User completed Rust project...",        // Summarized (for search)
  contentVerbatim: "omg omg omg!!! 😊✨ I just...", // Original (for reference)
  summarized: true
}
```

**Pros:**

- Best of both worlds
- Can retrieve exact wording if needed
- Semantic search uses clean summary

**Cons:**

- No storage savings
- More complex

**Recommendation:** Start with verbatim-only, add summarization when needed
