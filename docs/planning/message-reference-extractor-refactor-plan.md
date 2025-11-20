# MessageReferenceExtractor Refactoring Plan

**Status**: Planned
**Created**: 2025-11-14
**Context**: MessageReferenceExtractor has grown to 757 lines and needs to be broken into smaller, focused components

## Problem Statement

MessageReferenceExtractor is too large (757 lines) and handles too many responsibilities:

- Extracting reply references
- Parsing Discord message URLs
- Fetching messages from Discord API
- Handling forwarded messages
- Retrieving voice transcripts
- Formatting referenced messages
- Deduplication logic

This makes it:

- Hard to test in isolation
- Difficult to understand and maintain
- Prone to hidden dependencies
- Challenging to extend with new features

## Proposed Component-Based Architecture

Break the monolith into specialized "workers" that collaborate, with the main class becoming an "orchestrator."

### Proposed Classes

#### 1. MessageLinkParser

**Responsibility**: Find and validate Discord message URLs within text
**Methods**:

- `parse(content: string): DiscordLink[]`

**Benefits**:

- Pure function with no external dependencies
- Easy to test with simple string inputs
- Follows existing utility pattern

#### 2. ForwardedMessageParser

**Responsibility**: Parse forwarded message snapshot text to extract original author, content, and timestamp
**Methods**:

- `parse(content: string): ForwardedMessageData | null`

**Benefits**:

- Isolates complex/brittle parsing logic
- Easy to update if forwarded message format changes
- Testable with mock text inputs

#### 3. DiscordMessageProvider

**Responsibility**: Fetch Discord messages by ID from the Discord API
**Methods**:

- `fetchById(channelId: string, messageId: string): Promise<Discord.Message | null>`
- `fetchByIds(links: DiscordLink[]): Promise<Discord.Message[]>`

**Benefits**:

- Single point of interaction with discord.js client
- Can handle rate limiting and batching
- Easy to mock for tests

#### 4. VoiceTranscriptRepository

**Responsibility**: Retrieve voice transcripts with two-tier caching (Redis + Database)
**Methods**:

- `getTranscript(messageId: string): Promise<string | null>`

**Benefits**:

- Encapsulates caching strategy
- Rest of app doesn't need to know about Redis/DB
- Easy to change caching implementation

**Note**: This already exists as the `retrieveVoiceTranscript()` method - extract it!

#### 5. ReferencedMessageFactory

**Responsibility**: Convert different data sources into consistent ReferencedMessage objects
**Methods**:

- `createFromDiscordMessage(message: Discord.Message, transcript?: string): ReferencedMessage`
- `createFromForwardedMessage(data: ForwardedMessageData): ReferencedMessage`

**Benefits**:

- Centralizes ReferencedMessage creation logic
- Single place to update if ReferencedMessage type changes
- Separates "what the data is" from "how it was obtained"

#### 6. ReferenceExtractor (new slim version)

**Responsibility**: Coordinate the entire reference extraction process
**Dependencies**: All of the above (injected)
**Main Method**: `extract(message: Discord.Message): Promise<ReferencedMessage[]>`

**Internal Logic**:

1. Use MessageLinkParser to get URLs from message content
2. Use DiscordMessageProvider to fetch messages for those URLs
3. Use ForwardedMessageParser to handle forwarded content
4. For voice messages, use VoiceTranscriptRepository
5. Use ReferencedMessageFactory to create ReferencedMessage objects
6. Perform final deduplication and filtering

**Benefits**:

- Thin orchestration layer
- All complexity delegated to specialists
- Easy to understand flow
- Highly testable with mocked dependencies

## Incremental Refactoring Strategy

### Step 0: Safety Net (DO NOT SKIP!)

Write characterization tests (golden master testing) for `extractReferences()`:

1. Cover all edge cases: no links, multiple links, forwarded messages, voice messages, invalid links, etc.
2. Capture actual output as snapshots/golden masters
3. Tests assert output always matches snapshot
4. These tests verify behavior doesn't change during refactoring

### Step 1: Extract MessageLinkParser

1. Create `MessageLinkParser.ts`
2. Move `parseMessageLinks` logic into `parse()` method
3. Write focused unit tests
4. Update MessageReferenceExtractor to use new parser
5. Run all tests (unit + characterization)
6. **Create small PR** for this change alone

### Step 2: Extract VoiceTranscriptRepository

1. Create `VoiceTranscriptRepository.ts`
2. Move `retrieveVoiceTranscript` logic into `getTranscript()` method
3. Inject Redis and DB clients into constructor
4. Write unit tests mocking Redis/DB
5. Update MessageReferenceExtractor to use repository
6. Run all tests
7. **Create small PR**

### Step 3: Define Interfaces and Use DI

1. Create interfaces: `IMessageLinkParser`, `IVoiceTranscriptRepository`
2. Make classes implement interfaces
3. Change MessageReferenceExtractor to depend on interfaces, not concrete classes
4. Pass dependencies via constructor
5. **Create PR**

### Step 4: Extract Remaining Components

Continue extracting one component at a time:

- ForwardedMessageParser
- DiscordMessageProvider
- ReferencedMessageFactory

Each extraction gets its own PR.

### Step 5: Final Cleanup

- Review the slim MessageReferenceExtractor (should be ~150-200 lines)
- Consider renaming to ReferenceExtractor or ReferenceExtractionOrchestrator
- Update all documentation

## Benefits of This Approach

### Testability

- Each component is testable in isolation
- No need to mock Discord API for parser tests
- Can test caching logic without real Redis/DB

### Maintainability

- Single Responsibility Principle
- Clear separation of concerns
- Easy to find and fix bugs

### Extensibility

- Easy to add new reference types
- Can swap implementations (e.g., different cache)
- Simple to add new features to specific components

### Safety

- Incremental changes reduce risk
- Characterization tests catch regressions
- Small PRs are easy to review

## Alternative Approaches Considered

### Functional/Pipeline Approach

Use a chain of pure functions instead of classes:

```typescript
async function extractReferences(message: Discord.Message): Promise<ReferencedMessage[]> {
  const links = extractLinks(message.content);
  const fetchedMessages = await fetchMessages(links);
  const enrichedMessages = await enrichWithTranscripts(fetchedMessages);
  const references = formatToReferences(enrichedMessages);
  return deduplicate(references);
}
```

**Pros**: Highly testable, clear data flow, low coupling
**Cons**: Less intuitive for OOP teams, harder to manage state/complex dependencies

**Decision**: Stick with class-based approach for consistency with existing codebase

### Strategy Pattern for Multi-Platform

Define strategies for different platforms (Discord, Slack, Telegram):

- `ISourceParser` interface with `DiscordLinkParser`, `SlackLinkParser` implementations
- `IMessageProvider` interface with `DiscordApiProvider`, `SlackApiProvider` implementations

**Decision**: YAGNI - We only support Discord. Don't over-engineer for future platforms.

## Potential Challenges

### Challenge 1: Dependency Management

The new ReferenceExtractor will depend on 5-6 classes.

**Solution**: Use constructor injection (simple DI). The code that creates ReferenceExtractor is responsible for creating and passing dependencies.

```typescript
// In your service setup
const linkParser = new MessageLinkParser();
const transcriptRepo = new VoiceTranscriptRepository(redisClient, dbConnection);
// ... etc
const referenceExtractor = new ReferenceExtractor(linkParser, transcriptRepo, ...);
```

### Challenge 2: Ensuring Identical Behavior

Risk of changing behavior during refactoring.

**Solution**: Characterization tests (Step 0). These act as a safety net that catches any behavioral changes.

### Challenge 3: Managing Large Refactor

Risk of huge, unreviewable PR.

**Solution**: Incremental refactoring with small PRs. Each component extraction is its own PR.

## Success Criteria

- [ ] All characterization tests written and passing
- [ ] All 6 components extracted into separate files
- [ ] All components have comprehensive unit tests
- [ ] ReferenceExtractor is < 200 lines
- [ ] All existing tests still pass
- [ ] No behavioral changes detected
- [ ] Code review approved
- [ ] Deployed to development without issues

## References

- **Original Issue**: MessageReferenceExtractor is 757 lines (too large)
- **Gemini Brainstorm**: 2025-11-14 (full details in this conversation)
- **Related Work**: MessageHandler refactoring (Chain of Responsibility pattern) - completed 2025-11-14

## Notes

- This refactoring was planned after successfully completing the MessageHandler refactor using Chain of Responsibility pattern
- The voice transcript retrieval feature was just added (2025-11-14), so that logic is fresh and well-tested
- Characterization tests are CRITICAL - do not skip Step 0!
