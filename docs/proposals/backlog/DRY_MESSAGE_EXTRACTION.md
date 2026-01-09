# DRY Refactor: Unified Message Extraction Architecture

**Status**: Planning Complete - Deferred
**Priority**: High (after bugfix release)
**Estimated Effort**: 2-3 sessions
**Created**: 2026-01-03

## Problem Statement

We have two parallel paths for processing Discord messages that keep diverging, causing recurring bugs where one path has features the other doesn't (e.g., forwarded message attachments).

### Current Architecture

```
Path 1: Main Message (sync)              Path 2: Extended Context (async)
─────────────────────────────            ────────────────────────────────
MessageFormatter                         DiscordChannelFetcher
SnapshotFormatter                        HistoryLinkResolver
  ↓                                        ↓
Direct utility calls:                    MessageContentBuilder
- extractAttachments()                     ↓
- extractEmbedImages()                   Same utilities (wrapped)
- EmbedParser                              ↓
  ↓                                        ↓
ReferencedMessage                        ConversationMessage
```

### Root Cause

- Both paths use the same underlying utilities but call them differently
- Main path is synchronous (command handler context)
- Extended path is async (voice transcript retrieval)
- No shared "source of truth" for extraction logic
- Bug fixes in one path don't propagate to the other

### Recent Bugs from This Pattern

1. **2026-01-03**: Forwarded message attachments not extracted in extended context
2. **Previous**: Extended context missing embed images
3. **Previous**: Voice transcript handling inconsistencies

## Solution: Intermediate Representation (IR) Pattern

### Core Concept

Extract all synchronous extraction logic into a single pure function that returns a neutral data structure (`UnifiedMessageContent`). Both paths consume this IR and map it to their specific output types.

### New Architecture

```
                    ┌─────────────────────────┐
                    │   Discord Message       │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  extractMessageContent  │  ← SINGLE SOURCE OF TRUTH
                    │      (pure, sync)       │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  UnifiedMessageContent  │  ← Intermediate Representation
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│   toReferencedMessage   │         │  toConversationMessage  │
│       (sync map)        │         │   (async, adds voice)   │
└─────────────────────────┘         └─────────────────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│   ReferencedMessage     │         │   ConversationMessage   │
└─────────────────────────┘         └─────────────────────────┘
```

## Implementation Plan

### Phase 1: Define the IR Type

**File**: `services/bot-client/src/utils/MessageExtractionCore.ts`

```typescript
/**
 * Unified message content - intermediate representation for all message paths.
 * This is the SINGLE SOURCE OF TRUTH for message content extraction.
 */
export interface UnifiedMessageContent {
  // Core content
  textContent: string;

  // Attachments from all sources (ordered: snapshot → regular → embed)
  attachments: AttachmentMetadata[];

  // Embed content (parsed to text)
  embedText: string;

  // Flags
  isForwarded: boolean;
  hasVoiceMessage: boolean;

  // Voice message metadata (for async transcript fetch)
  voiceAttachments: AttachmentMetadata[];

  // Forwarded message snapshots (for recursive processing)
  forwardedSnapshots: UnifiedMessageContent[];

  // Raw data preserved for path-specific needs
  rawEmbeds: Embed[];
}
```

### Phase 2: Implement Core Extraction Function

**File**: `services/bot-client/src/utils/MessageExtractionCore.ts`

```typescript
/**
 * Extract all message content synchronously.
 * This is the ONLY place extraction logic should live.
 *
 * @param message - Discord message or snapshot
 * @returns Unified content ready for mapping to any output type
 */
export function extractMessageContent(message: Message | MessageSnapshot): UnifiedMessageContent {
  // 1. Handle forwarded message snapshots (recursive)
  // 2. Extract text content
  // 3. Extract all attachments (snapshot + regular + embed images)
  // 4. Parse embeds to text
  // 5. Detect voice messages
  // 6. Return unified structure
}
```

### Phase 3: Create Mapper Functions

**File**: `services/bot-client/src/utils/MessageExtractionCore.ts`

```typescript
/**
 * Map unified content to ReferencedMessage (sync).
 * Used by: MessageFormatter, SnapshotFormatter
 */
export function toReferencedMessage(
  content: UnifiedMessageContent,
  metadata: {
    referenceNumber: number;
    discordMessageId: string;
    author: { id: string; username: string; displayName: string };
    timestamp: string;
    locationContext: string;
    webhookId?: string;
  }
): ReferencedMessage;

/**
 * Map unified content to ConversationMessage (async).
 * Used by: DiscordChannelFetcher, HistoryLinkResolver
 *
 * Handles voice transcript retrieval internally.
 */
export async function toConversationMessage(
  content: UnifiedMessageContent,
  metadata: {
    messageId: string;
    author: { id: string; username: string; displayName: string };
    createdAt: Date;
    botUserId: string;
    personalityName: string;
    personalityId: string;
  },
  options?: {
    getTranscript?: (messageId: string, url: string) => Promise<string | null>;
  }
): Promise<ConversationMessage>;
```

### Phase 4: Refactor Consumers

#### 4a. MessageFormatter (sync path)

**File**: `services/bot-client/src/handlers/references/MessageFormatter.ts`

```typescript
// Before:
const regularAttachments = extractAttachments(message.attachments);
const embedImages = extractEmbedImages(message.embeds);
const allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];
// ... more extraction logic

// After:
const unified = extractMessageContent(message);
return toReferencedMessage(unified, {
  referenceNumber,
  discordMessageId: message.id,
  author: { ... },
  timestamp: message.createdAt.toISOString(),
  locationContext,
});
```

#### 4b. SnapshotFormatter (sync path)

**File**: `services/bot-client/src/handlers/references/SnapshotFormatter.ts`

```typescript
// Before:
const regularAttachments = extractAttachments(snapshot.attachments);
const embedImages = extractEmbedImages(snapshot.embeds);
// ... more extraction logic

// After:
const unified = extractMessageContent(snapshot);
return toReferencedMessage(unified, {
  referenceNumber,
  discordMessageId: forwardedFrom.id,
  author: { id: 'unknown', username: 'Unknown User', displayName: 'Unknown User' },
  timestamp: snapshot.createdTimestamp ? new Date(snapshot.createdTimestamp).toISOString() : ...,
  locationContext: `${locationContext} (forwarded message)`,
  isForwarded: true,
});
```

#### 4c. DiscordChannelFetcher (async path)

**File**: `services/bot-client/src/services/DiscordChannelFetcher.ts`

```typescript
// Before:
const { content, attachments, isForwarded } = await buildMessageContent(msg, options);
// ... conversion to ConversationMessage

// After:
const unified = extractMessageContent(msg);
return toConversationMessage(unified, {
  messageId: msg.id,
  author: { ... },
  createdAt: msg.createdAt,
  botUserId,
  personalityName,
  personalityId,
}, { getTranscript });
```

#### 4d. MessageContentBuilder (deprecate or thin wrapper)

**File**: `services/bot-client/src/utils/MessageContentBuilder.ts`

Options:

1. **Deprecate**: Mark as `@deprecated`, point to `extractMessageContent`
2. **Thin wrapper**: Keep API but internally call `extractMessageContent`

Recommendation: Thin wrapper for backward compatibility, with deprecation warnings in logs.

### Phase 5: Update MessageContextBuilder

**File**: `services/bot-client/src/services/MessageContextBuilder.ts`

The main message extraction (lines 419-425) should also use the core:

```typescript
// Before:
const regularAttachments = extractAttachments(message.attachments);
const embedImages = extractEmbedImages(message.embeds);
const allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];

// After:
const unified = extractMessageContent(message);
// Use unified.attachments directly
```

### Phase 6: Testing Strategy

1. **Unit tests for core extraction**:
   - Regular messages
   - Messages with attachments
   - Messages with embeds
   - Forwarded messages with snapshots
   - Voice messages
   - Combined cases

2. **Integration tests**:
   - Main path produces identical ReferencedMessage output
   - Extended path produces identical ConversationMessage output
   - Forwarded message attachments flow through both paths

3. **Regression tests**:
   - All existing MessageFormatter tests pass
   - All existing SnapshotFormatter tests pass
   - All existing DiscordChannelFetcher tests pass
   - All existing MessageContentBuilder tests pass

## Files to Modify

### New Files

- `services/bot-client/src/utils/MessageExtractionCore.ts` (core logic)
- `services/bot-client/src/utils/MessageExtractionCore.test.ts` (tests)

### Modified Files

- `services/bot-client/src/handlers/references/MessageFormatter.ts`
- `services/bot-client/src/handlers/references/SnapshotFormatter.ts`
- `services/bot-client/src/services/DiscordChannelFetcher.ts`
- `services/bot-client/src/services/MessageContextBuilder.ts`
- `services/bot-client/src/utils/MessageContentBuilder.ts`
- `services/bot-client/src/utils/HistoryLinkResolver.ts`

### Potentially Deprecated

- `services/bot-client/src/utils/attachmentExtractor.ts` (move to internal)
- `services/bot-client/src/utils/embedImageExtractor.ts` (move to internal)

## Risk Mitigation

1. **Strangler Fig Pattern**: Implement new core alongside existing code, migrate incrementally
2. **Feature Flags**: Add config to switch between old/new extraction during testing
3. **Comprehensive Testing**: Ensure all existing tests pass before removing old code
4. **Output Comparison**: Log both old and new outputs in dev to verify equivalence

## Success Criteria

1. Single extraction function handles all message types
2. Both paths produce identical attachment/embed/content extraction
3. New features (like forwarded message handling) automatically work in both paths
4. No performance regression in main message path
5. All existing tests pass
6. Code coverage maintained or improved

## Dependencies

- None (internal refactor)

## Follow-up Work

After this refactor:

1. Consider extracting more shared logic (e.g., transcript retrieval)
2. Add structured logging for extraction debugging
3. Document the architecture in `docs/architecture/`
