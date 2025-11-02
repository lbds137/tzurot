# Message Reference System - Implementation Plan

> Created: 2025-11-02
> Status: Architecture finalized, ready for implementation
> Estimated Effort: 2-3 days

## Executive Summary

This plan outlines the implementation of the Message Reference System, which extracts context from Discord replies and message links, adding up to 10 referenced messages to the AI's context.

**Key Features:**
- Extract content from replied-to messages
- Parse Discord message links in user messages
- Replace links with numbered references (Reference 1, Reference 2, etc.)
- Full embed extraction from all referenced messages
- **Extract embeds from the main message itself** (wait for Discord to process)
- **2-3 second delay to allow Discord embed processing** (and future PluralKit proxies)
- Separate "Referenced Messages" section in AI prompt
- Max 10 references (configurable per personality)

## Complexity Assessment

### Overall Complexity: **Medium** 🟡

**Why Medium:**
- ✅ **Low Complexity**: Discord API for message fetching is straightforward
- ✅ **Low Complexity**: Link parsing with regex is simple
- 🟡 **Medium Complexity**: Coordinating numbered references across message and prompt
- 🟡 **Medium Complexity**: Embed parsing into LLM-friendly format
- 🟡 **Medium Complexity**: Handling inaccessible channels gracefully
- 🟡 **Medium Complexity**: Persona lookups for referenced message authors

**Estimated Effort:**
- Implementation: 1.5-2 days
- Testing: 0.5-1 day
- **Total: 2-3 days**

---

## Part 1: Files to Create

### New Files in bot-client

#### 1. `services/bot-client/src/context/MessageReferenceExtractor.ts`
**Purpose**: Core orchestration - extracts references from Discord messages

**Responsibilities:**
- Detect reply-to message (from `message.reference`)
- Parse Discord message links from message content
- Fetch referenced messages from Discord API
- Handle inaccessible channels/messages gracefully
- Extract content + embeds from each referenced message
- Look up or create personas for referenced message authors
- Return structured reference data with numbering

**Key Methods:**
```typescript
export class MessageReferenceExtractor {
  constructor(
    private userService: UserService,
    private messageClient: DiscordMessageFetcher
  ) {}

  async extractReferences(
    message: Message,
    maxReferences: number = 10
  ): Promise<ExtractedReferences> {
    // 1. Check for reply-to message
    // 2. Parse message links from content
    // 3. Deduplicate (reply-to might also be in links)
    // 4. Fetch messages (up to max limit)
    // 5. Extract content + embeds for each
    // 6. Look up persona for each author
    // 7. Return structured data with numbering
  }
}
```

**Estimated Lines**: ~200-250

---

#### 2. `services/bot-client/src/utils/EmbedParser.ts`
**Purpose**: Parse Discord embeds into LLM-friendly text format

**Responsibilities:**
- Extract title, description, fields, images, footers from embeds
- Format into readable text structure
- Handle all Discord embed types (rich, image, video, link, etc.)
- Preserve important metadata (timestamps, URLs)

**Key Methods:**
```typescript
export class EmbedParser {
  parseEmbeds(embeds: Discord.Embed[]): string {
    // Convert embed objects to formatted text
    // Format: [Embed Title: ...] [Embed Description: ...] [Field - Name: Value]
  }

  private parseEmbed(embed: Discord.Embed): string {
    // Parse single embed with all fields
  }

  private formatEmbedFields(fields: Discord.EmbedField[]): string {
    // Format embed fields into readable text
  }
}
```

**Estimated Lines**: ~100-150

---

#### 3. `services/bot-client/src/utils/MessageLinkParser.ts`
**Purpose**: Parse Discord message links and extract IDs

**Responsibilities:**
- Regex pattern for Discord message links
- Extract guild/channel/message IDs from URLs
- Validate link format
- Handle different Discord URL formats (discord.com, ptb, canary, discordapp.com)

**Key Methods:**
```typescript
export class MessageLinkParser {
  static readonly MESSAGE_LINK_REGEX =
    /https:\/\/(ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/g;

  parseMessageLinks(content: string): ParsedMessageLink[] {
    // Find all message links in content
    // Return array of { guildId, channelId, messageId, fullUrl }
  }

  replaceLinksWithReferences(
    content: string,
    linkMap: Map<string, number>
  ): string {
    // Replace URLs with "Reference N"
  }
}
```

**Estimated Lines**: ~80-100

---

#### 4. Test Files

**`services/bot-client/src/context/MessageReferenceExtractor.test.ts`**
- Test reply-to message extraction
- Test message link parsing
- Test max reference limit (10)
- Test deduplication
- Test inaccessible channel handling
- Test persona lookup/creation
- Test numbering consistency

**Estimated Lines**: ~250-300

**`services/bot-client/src/utils/EmbedParser.test.ts`**
- Test all embed types (rich, image, video, link)
- Test field formatting
- Test missing/optional embed data
- Test multiple embeds
- Test LLM-friendly output format

**Estimated Lines**: ~150-200

**`services/bot-client/src/utils/MessageLinkParser.test.ts`**
- Test link parsing (all URL formats)
- Test link replacement with numbers
- Test invalid URLs
- Test mixed content (text + links)

**Estimated Lines**: ~100-150

---

## Part 2: Files to Modify

### bot-client Modifications

#### 1. `services/bot-client/src/handlers/MessageHandler.ts`
**Changes Needed:**
- **Add 2-3 second delay after message received** to allow Discord embed processing
- **Re-fetch message to get processed embeds**
- Extract embeds from main message using EmbedParser
- Call `MessageReferenceExtractor` before sending to gateway
- Replace message links with numbered references in message content
- Pass extracted references in context
- **Include main message embeds in messageContent**

**Impact**: Medium - Core message flow
**Lines Changed**: ~50-60 (increased due to embed extraction)

**Example:**
```typescript
// After line ~250 (before calling gateway)

// Wait for Discord to process embeds (and PluralKit proxies in future)
// 2-3 seconds gives Discord plenty of time
await new Promise(resolve => setTimeout(resolve, 2500));

// Re-fetch message to get processed embeds
const refreshedMessage = await message.channel.messages.fetch(message.id);

// Extract embeds from main message
let embedContent = '';
if (refreshedMessage.embeds.length > 0) {
  embedContent = this.embedParser.parseEmbeds(refreshedMessage.embeds);
}

// Extract referenced messages
const referencesData = await this.referenceExtractor.extractReferences(
  refreshedMessage,
  personality.maxReferencedMessages || 10
);

// Replace links in content
const processedContent = referencesData.linkMap.size > 0
  ? MessageLinkParser.replaceLinksWithReferences(content, referencesData.linkMap)
  : content;

// Combine message content with embeds
const fullContent = embedContent
  ? `${processedContent}\n\n${embedContent}`
  : processedContent;

// Add to context
const context: MessageContext = {
  // ... existing fields
  referencedMessages: referencesData.references,
  messageContent: fullContent
};
```

---

#### 2. `services/bot-client/src/types.ts`
**Changes Needed:**
- Extend `MessageContext` interface to include `referencedMessages` array
- Remove simple `referencedMessage` field (replacing with richer structure)

**Impact**: Low - Type definitions
**Lines Changed**: ~15-20

**Example:**
```typescript
export interface MessageContext extends Omit<RequestContext, 'conversationHistory'> {
  messageContent: string;
  conversationHistory?: Array<...>;
  referencedMessages?: Array<{
    number: number; // Reference 1, Reference 2, etc.
    author: string;
    authorPersonaId?: string;
    authorPersonaName?: string;
    content: string;
    embeds?: string; // Parsed embed text
    timestamp: string;
    messageUrl: string;
  }>;
}
```

---

### common-types Modifications

#### 3. `packages/common-types/src/schemas.ts`
**Changes Needed:**
- Add `referencedMessages` field to `requestContextSchema`
- Add `maxReferencedMessages` field to `personalityConfigSchema`

**Impact**: Low - Schema additions
**Lines Changed**: ~25-30

**Example:**
```typescript
// In requestContextSchema:
referencedMessages: z.array(z.object({
  number: z.number(),
  author: z.string(),
  authorPersonaId: z.string().optional(),
  authorPersonaName: z.string().optional(),
  content: z.string(),
  embeds: z.string().optional(),
  timestamp: z.string(),
  messageUrl: z.string()
})).optional()

// In personalityConfigSchema:
maxReferencedMessages: z.number().optional() // Default: 10
```

---

### ai-worker Modifications

#### 4. `services/ai-worker/src/services/ConversationalRAGService.ts`
**Changes Needed:**
- Add "Referenced Messages" section to system prompt when references exist
- Format referenced messages with numbered headers
- Include persona info if available

**Impact**: Low-Medium - Prompt assembly
**Lines Changed**: ~40-50

**Example:**
```typescript
// In buildFullSystemPrompt() method, after memoryContext:

// Referenced messages (if any)
const referencedMessagesContext = context.referencedMessages && context.referencedMessages.length > 0
  ? '\n\n## Referenced Messages\n' +
    context.referencedMessages.map((ref) => {
      const header = `[Reference ${ref.number}]`;
      const author = ref.authorPersonaName || ref.author;
      const timestamp = formatMemoryTimestamp(ref.timestamp);
      const embedInfo = ref.embeds ? `\n${ref.embeds}` : '';

      return `${header} ${author} [${timestamp}]:\n${ref.content}${embedInfo}`;
    }).join('\n\n')
  : '';

const fullSystemPrompt = `${systemPrompt}${dateContext}${environmentContext}${participantsContext}${memoryContext}${referencedMessagesContext}`;
```

---

## Part 3: Testing Strategy

### Unit Tests (Priority 1)

**MessageLinkParser Tests:**
- ✅ Parse various Discord URL formats
- ✅ Handle invalid URLs
- ✅ Replace links with numbered references
- ✅ Preserve non-link text

**EmbedParser Tests:**
- ✅ Parse rich embeds (title, description, fields)
- ✅ Parse image embeds
- ✅ Parse video embeds
- ✅ Handle missing optional fields
- ✅ Format multiple embeds
- ✅ Verify LLM-friendly output

**MessageReferenceExtractor Tests:**
- ✅ Extract reply-to message
- ✅ Parse message links from content
- ✅ Deduplicate references
- ✅ Enforce max limit (10 references)
- ✅ Handle inaccessible channels (skip silently)
- ✅ Handle inaccessible messages (skip silently)
- ✅ Look up existing personas
- ✅ Create default personas for new authors
- ✅ Consistent numbering

### Integration Tests (Priority 2)

**Full Message Flow:**
- Reply to bot message → Reference extracted
- Message with Discord link → Link replaced with "Reference 1"
- Message with multiple links → All replaced with numbers
- Reply + links → Deduplication works
- Max 10 references enforced
- References appear in AI prompt correctly

### Manual Testing Scenarios

1. **Simple Reply**: Reply to a bot message, verify context includes it
2. **Link Parsing**: Send message with Discord link, verify replacement
3. **Multiple Links**: Send 5 links, verify all numbered correctly
4. **Reply + Links**: Reply to message AND include links, verify dedup
5. **Max Limit**: Send 15 links, verify only 10 processed
6. **Inaccessible**: Link to deleted message, verify graceful skip
7. **Embeds**: Reference message with rich embed, verify embed extracted
8. **Personas**: Reference message from new user, verify persona created
9. **Main Message Embed**: Send YouTube/Twitter link, verify embed extracted after delay
10. **Main + Referenced Embeds**: Send message with embed that references another embed

---

## Part 4: Refactoring Needed

### Prerequisite: None Required ✅

**Good News:** No blocking refactoring needed! The current architecture supports this feature cleanly.

**Why This Works:**
- `MessageHandler` already has extension points (before gateway call)
- `MessageContext` type is extensible (just add field)
- `RequestContext` schema accepts additions
- `ConversationalRAGService` prompt building is modular

### Optional Improvements (Post-Implementation)

These could improve code quality but aren't blockers:

1. **Extract Message Fetching Logic** (Optional)
   - Create `DiscordMessageFetcher` utility class
   - Handles retries, rate limiting, error handling
   - Testable in isolation
   - **Effort**: 0.5 days

2. **Persona Service Cleanup** (Optional)
   - Consolidate persona lookup/creation logic
   - Currently scattered across files
   - **Effort**: 0.5 days

---

## Part 5: Dependencies and Integration Points

### External Dependencies

**Discord.js API:**
- `message.reference.messageId` - Built-in
- `channel.messages.fetch(messageId)` - Built-in
- `message.embeds` - Built-in
- No new dependencies needed! ✅

**Internal Dependencies:**
- `UserService` (existing) - For persona lookups
- `ConversationHistoryService` (existing) - Might be useful for caching
- No new services needed! ✅

### Integration Points

**1. MessageHandler → MessageReferenceExtractor**
- Call before gateway
- Pass Discord message object
- Get back structured reference data

**2. MessageHandler → GatewayClient**
- Include `referencedMessages` in context
- Pass processed content (links replaced)

**3. GatewayClient → API Gateway**
- Forward `referencedMessages` in request body
- Validated by schema

**4. API Gateway → AI Worker**
- Pass through in job data
- No transformation needed

**5. AI Worker → ConversationalRAGService**
- Build "Referenced Messages" prompt section
- Format with numbering

---

## Part 6: Error Handling Strategy

### Graceful Degradation

**Philosophy**: Missing references should NOT break the entire request.

**Error Scenarios:**

1. **Message Fetch Fails** (404, 403, etc.)
   - Log warning
   - Skip that reference
   - Continue with others

2. **Channel Inaccessible** (403 Forbidden)
   - Log info (expected scenario)
   - Skip silently
   - Continue with others

3. **Persona Lookup Fails**
   - Use author's display name as fallback
   - Don't create persona
   - Continue with reference

4. **Embed Parsing Fails**
   - Log error
   - Include message content without embeds
   - Continue

5. **Too Many References** (>10)
   - Take first 10 (or most recent 10)
   - Log info about truncation
   - Continue

**Error Logging:**
- DEBUG level: Normal skips (inaccessible channels)
- WARN level: Unexpected failures (API errors)
- ERROR level: Critical failures (should never happen)

---

## Part 7: Performance Considerations

### Message Fetching

**Concern**: Fetching 10 messages sequentially could be slow

**Solution**: Fetch in parallel
```typescript
const fetchPromises = linksToParse.map(link =>
  this.fetchMessage(link).catch(err => {
    logger.warn({ err, link }, 'Failed to fetch referenced message');
    return null;
  })
);
const results = await Promise.allSettled(fetchPromises);
```

**Impact**: 10 parallel fetches ~500ms vs 10 sequential ~5s

### Caching Opportunities

**Message Cache** (Future Enhancement):
- Cache fetched messages for 5 minutes
- Key: `${guildId}:${channelId}:${messageId}`
- Reduces duplicate fetches in rapid conversations

**Persona Cache** (Already Exists):
- UserService already caches personas
- No additional work needed ✅

---

## Part 8: Configuration

### Personality Config

Add to `personality.json` files:
```json
{
  "maxReferencedMessages": 10
}
```

**Default**: 10 if not specified
**Range**: 0-10 (enforce in schema)

### Global Config (Future)

Could add to bot config later:
- `MAX_REFERENCE_DEPTH` - How many levels deep (currently: 1)
- `REFERENCE_CACHE_TTL` - Cache duration for fetched messages
- Not needed for v1 ✅

---

## Part 9: Rollout Plan

### Phase 1: Core Implementation (Days 1-2)

1. **Day 1 Morning**: Create utility classes
   - MessageLinkParser + tests
   - EmbedParser + tests
   - Run tests, verify all pass

2. **Day 1 Afternoon**: MessageReferenceExtractor
   - Implement core extraction logic
   - Write comprehensive tests
   - Run tests, verify all pass

3. **Day 2 Morning**: Integration
   - Modify MessageHandler
   - Modify types (MessageContext, RequestContext)
   - Modify ConversationalRAGService prompt building

4. **Day 2 Afternoon**: Testing
   - Run full test suite
   - Manual testing scenarios
   - Fix any issues

### Phase 2: Polish and Deploy (Day 3)

1. **Morning**: Edge case handling
   - Test with broken links
   - Test with deleted messages
   - Test with inaccessible channels
   - Fix any issues

2. **Afternoon**: Documentation and PR
   - Update CHANGELOG.md
   - Create PR with comprehensive description
   - Address code review feedback
   - Merge and deploy

---

## Part 10: Success Criteria

### Functional Requirements

- ✅ Reply-to messages extracted correctly
- ✅ Message links parsed from content
- ✅ Links replaced with "Reference N" in message
- ✅ Max 10 references enforced
- ✅ Inaccessible channels skipped silently
- ✅ Full embeds extracted and formatted
- ✅ Personas looked up/created for authors
- ✅ References appear in AI prompt correctly
- ✅ Numbering consistent between message and prompt

### Quality Requirements

- ✅ All unit tests passing
- ✅ All integration tests passing
- ✅ No TypeScript errors
- ✅ No ESLint errors
- ✅ Code coverage maintained (or improved)
- ✅ Manual testing scenarios verified

### Performance Requirements

- ✅ Reference extraction <1s for 10 references
- ✅ No blocking delays in message flow
- ✅ Parallel fetching implemented

---

## Part 11: Risk Assessment

### Low Risk 🟢

- Schema changes (adding optional fields)
- Utility class creation (isolated, testable)
- Embed parsing (straightforward logic)
- Link parsing (well-defined regex)

### Medium Risk 🟡

- Message fetching (external API, can fail)
  - **Mitigation**: Parallel fetching, error handling, graceful degradation

- Persona lookups (database operations)
  - **Mitigation**: Existing UserService is battle-tested, has error handling

- Prompt length (10 references could be large)
  - **Mitigation**: Can reduce maxReferencedMessages per personality if needed

### High Risk 🔴

- None identified! ✅

---

## Part 12: Future Enhancements (Out of Scope)

These are explicitly NOT part of v1:

1. **PluralKit Proxy Support** (NEAR FUTURE - High Priority)
   - The 500ms delay paves the way for this
   - Need to detect PluralKit proxied messages
   - Associate proxied webhook messages with original user
   - Use user's persona instead of creating new one for webhook
   - Complexity: Medium
   - Value: High (many users use PluralKit)
   - Decision: Next feature after message references

2. **Nested References** (References within references)
   - Complexity: High
   - Value: Low (rarely needed)
   - Decision: Start with 1 level deep

3. **Cross-Server References** (References to other servers)
   - Complexity: Medium
   - Value: Low (rare use case)
   - Decision: Skip for now

4. **Reference Preview** (Show reference content in Discord)
   - Complexity: Medium
   - Value: Medium (nice-to-have UX)
   - Decision: v2 feature

5. **Reference Analytics** (Track which references get used)
   - Complexity: Low
   - Value: Low (analytics not priority)
   - Decision: Later if needed

---

## Summary

**Estimated Effort:** 2-3 days

**Complexity:** Medium 🟡

**Risk Level:** Low 🟢

**Files to Create:** 3 main files + 3 test files

**Files to Modify:** 4 files across services

**Tests Needed:**
- 9+ unit test suites
- 6+ integration test scenarios
- 8 manual test scenarios

**Blockers:** None! Ready to implement.

**Next Steps:**
1. Review this plan with user
2. Create feature branch
3. Start Day 1 implementation
4. Follow rollout plan

---

*Last Updated: 2025-11-02*
