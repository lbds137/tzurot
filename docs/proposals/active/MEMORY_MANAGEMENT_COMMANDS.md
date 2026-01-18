# Memory Management Commands Implementation Plan

> **Status**: Phase 1-2 COMPLETE ✅ — Phase 3 (Incognito) NEXT
> **Created**: 2025-12-13
> **Last Updated**: 2026-01-17
> **Priority**: High (User-requested feature)
> **Estimated Sessions**: 6-8

## Executive Summary

This document outlines the implementation plan for comprehensive memory management commands, enabling users to:

1. **Short-Term Memory (STM)**: Clear conversation context with optional restore capability ✅ COMPLETE
2. **Long-Term Memory (LTM)**: Search, browse, edit, and delete memories
3. **Focus Mode**: Temporarily disable LTM **reading** (memories not retrieved)
4. **Incognito Mode**: Temporarily disable LTM **writing** (memories not saved)
5. **Memory Browsing**: Dashboard-style view with filtering and inline editing

Key architectural decisions:

- **Context Epochs** (timestamp-based soft reset) for STM to enable non-destructive clearing with undo capability
- **Focus Mode vs Incognito**: Separate controls for reading vs writing LTM (different use cases)

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Command Structure](#command-structure)
3. [Feature Specifications](#feature-specifications)
4. [Schema Migrations](#schema-migrations)
5. [Implementation Phases](#implementation-phases)
6. [UX Patterns](#ux-patterns)
7. [API Routes](#api-routes)
8. [Security Considerations](#security-considerations)

---

## Design Principles

### 1. Non-Destructive by Default

STM clearing uses **Context Epochs** (ADR-003) - a timestamp marker that filters out older messages without deleting them. This enables "undo" by moving the timestamp backward.

```sql
-- Query with epoch filtering
SELECT * FROM conversation_history
WHERE created_at > COALESCE(last_context_reset, '1970-01-01')
ORDER BY created_at DESC
```

### 2. Explicit Consent for Destructive Operations

Truly destructive operations (LTM purge, hard STM delete) require:

- Red danger button (Discord `ButtonStyle.Danger`)
- Confirmation modal
- Typed confirmation phrase for high-risk operations

### 3. Semantic Search Over Pagination

For memory browsing, prioritize semantic search using pgvector:

- User queries in natural language
- System finds semantically similar memories
- Pagination as fallback, not primary UX

### 4. Incognito as Session State

Incognito mode is a **timed session state**, not a permanent toggle:

- Explicit enable/disable
- Optional auto-expire timer
- Visual indicator when active
- Per-personality or global scope

---

## Command Structure

### `/history` - Short-Term Memory Management

| Subcommand    | Description                             | Tier | Options                                                 |
| ------------- | --------------------------------------- | ---- | ------------------------------------------------------- |
| `clear`       | Soft reset conversation context         | 0    | `personality:`, `scope:[channel\|all]`                  |
| `undo`        | Restore cleared context                 | 0    | `personality:`                                          |
| `hard-delete` | Permanently delete conversation history | 0    | `personality:`, `timeframe:`, **requires confirmation** |
| `stats`       | View conversation statistics            | 0    | `personality:`                                          |

### `/memory` - Long-Term Memory Management

**Design Principle**: `/memory browse` opens a dashboard-style navigator. Individual memory operations (edit, delete, lock) happen within the browse UI via buttons. Standalone `/memory delete` and `/memory purge` are for **batch operations**.

| Subcommand | Description                                | Tier | Options                                                                    |
| ---------- | ------------------------------------------ | ---- | -------------------------------------------------------------------------- |
| `search`   | Semantic search → opens browser at results | 3    | `query:`, `personality:`, `persona:`, `date-range:`, `server:`, `channel:` |
| `browse`   | Open memory browser dashboard              | 2    | `personality:`, `persona:` (filters applied before browsing)               |
| `delete`   | **Batch** delete with filters              | 1    | `personality:`, `persona:`, `timeframe:`, **requires confirmation**        |
| `purge`    | Delete ALL memories for personality        | 1    | `personality:`, **requires typed confirmation**                            |
| `stats`    | View memory statistics                     | 0    | `personality:`                                                             |

**From within Browse Dashboard** (buttons, not subcommands):

- `[⏪ Prev]` / `[Next ⏩]` - Navigate through memories
- `[✏️ Edit]` - Open modal to edit current memory content
- `[🗑️ Delete]` - Delete current memory (with confirmation)
- `[🔒 Lock]` / `[🔓 Unlock]` - Toggle core memory protection
- `[❌ Close]` - Exit browser

### `/memory focus` - Memory Read Toggle ("Focus Mode")

**Design Principle**: Focus Mode disables LTM **reading** (retrieval), not writing. This is distinct from Incognito which disables **writing**. Use case: "I want the bot to respond without referencing past memories" without deleting anything.

| Subcommand | Description                    | Tier | Options                  |
| ---------- | ------------------------------ | ---- | ------------------------ |
| `enable`   | Disable LTM retrieval          | 0    | `personality:[specific]` |
| `disable`  | Re-enable LTM retrieval        | 0    | `personality:[specific]` |
| `status`   | Check current focus mode state | 0    | `personality:[specific]` |

**Visual Indicator**: When focus mode is active, bot responses include:

```
🔒 [Focus Mode Active]
*Response content here...*
━━━━━━━━━━━━━━━━━━━━━━━━
📭 Long-term memories are not being retrieved
```

### `/memory incognito` - Privacy Mode (Write Toggle)

**Design Principle**: Incognito Mode disables LTM **writing** (storage), not reading. This is distinct from Focus Mode which disables **reading**. Use case: "I want to have a private conversation that won't be remembered."

| Subcommand | Description                     | Tier | Options                                                                |
| ---------- | ------------------------------- | ---- | ---------------------------------------------------------------------- |
| `enable`   | Start incognito session         | 0    | `personality:[specific\|all]`, `duration:[30m\|1h\|4h\|until-disable]` |
| `disable`  | End incognito session           | 0    | -                                                                      |
| `status`   | Check current incognito state   | 0    | -                                                                      |
| `forget`   | Retroactively delete recent LTM | 1    | `timeframe:[5m\|15m\|1h]`, **requires confirmation**                   |

**Visual Indicator**: When incognito is active, bot responses include:

```
👻 [Incognito Mode Active]
*Response content here...*
━━━━━━━━━━━━━━━━━━━━━━━━
🛑 This conversation is not being saved to long-term memory
⏱️ Incognito expires in: 45 minutes
```

**Note**: Previously this was a separate `/incognito` top-level command. Moved under `/memory` for consistency - all LTM controls in one place.

---

## Feature Specifications

### F1: STM Context Clearing (Epoch-Based)

**Mechanism**: Store `lastContextReset` timestamp on UserPersonalityConfig

**Soft Clear Flow**:

1. User runs `/history clear personality:Lilith`
2. System sets `lastContextReset = NOW()` for that user-personality pair
3. All queries for conversation history filter by `created_at > lastContextReset`
4. Old messages still exist but aren't included in context

**Undo Flow**:

1. User runs `/history undo personality:Lilith`
2. System stores previous `lastContextReset` in `previousContextReset` before clearing
3. Undo restores the previous timestamp (or null to include all)
4. Only one level of undo supported

**Scope Options**:

- `channel` - Clear only current channel (requires channel-specific epoch)
- `all` - Clear all channels for that personality

### F2: STM Hard Delete

**When Needed**: User wants to permanently remove embarrassing/private messages

**Flow**:

1. User runs `/history hard-delete personality:Lilith timeframe:24h`
2. System shows warning: "This will permanently delete {N} messages. This cannot be undone."
3. Red "Delete Permanently" button
4. On confirm, actually DELETE rows from database
5. Show completion message with count

### F3: LTM Reset/Purge

**Per-Personality Purge**:

```
/memory purge personality:Lilith
```

- Deletes all pgvector memories for that personality-user pair
- Requires typed confirmation: "Type 'DELETE LILITH MEMORIES' to confirm"

**All-Personality Purge**:

```
/memory purge personality:all
```

- Nuclear option - deletes ALL memories for the user
- Requires typed confirmation: "Type 'DELETE ALL MEMORIES' to confirm"

**Timeframe Purge**:

```
/memory purge timeframe:7d personality:Lilith
```

- Delete memories older than 7 days
- Options: 1h, 24h, 7d, 30d, 1y, all

### F4: Incognito Mode

**Session State Model**:

```typescript
interface IncognitoSession {
  userId: string;
  personalityId: string | 'all';
  startedAt: Date;
  expiresAt: Date | null; // null = manual disable only
}
```

**Storage**: Redis with TTL for auto-expiration

**Behavior When Active**:

- Messages are processed normally (STM works)
- No new memories are written to LTM
- Visual indicator in bot responses (ghost emoji or similar)
- Optional: Different response style acknowledging incognito

**Auto-Expire Options**:

- 30 minutes, 1 hour, 4 hours
- "Until I turn it off" (no auto-expire)

### F5: Retroactive Forget ("Men In Black Flash")

**Use Case**: User said something they wish hadn't been recorded

**Flow**:

1. `/incognito forget timeframe:15m`
2. Deletes all LTM entries created in last 15 minutes
3. Requires confirmation: "This will delete {N} memories from the last 15 minutes"
4. Useful for "oops I shouldn't have said that"

### F6: Memory Search

**Primary Interface**: Semantic search using pgvector

```
/memory search query:"that conversation about pizza" personality:Lilith
```

**Flow**:

1. Generate embedding for query text
2. pgvector cosine similarity search
3. Filter by additional criteria (personality, persona, date range, server, channel)
4. Return top 5-10 matches as embed
5. Each result shows: snippet, timestamp, personality, source context
6. Buttons: [View Full] [Edit] [Delete]

**Advanced Filters** (autocomplete-driven):

- `personality:` - Which character
- `persona:` - Which user profile
- `date-range:` - Options: today, last-week, last-month, custom
- `server:` - Which Discord server (shows server names)
- `channel:` - Which channel (shows channel names)

### F7: Memory Browsing (Dashboard Pattern)

**Primary Interface**: Dashboard-style navigator similar to `/character edit`

```
/memory browse personality:Lilith persona:default
```

**UI Pattern**: "Memory Deck" with navigation and inline actions

```
┌─────────────────────────────────────────┐
│ 🧠 Memory 1 of 47                       │
├─────────────────────────────────────────┤
│ "User mentioned they love Italian food  │
│  and their favorite restaurant is..."   │
│                                         │
│ 📅 Created: 2 days ago                  │
│ 🎭 Personality: Lilith                  │
│ 👤 Persona: default                     │
│ 💬 Server: User's Server                │
│ 📍 Channel: #general                    │
│ 🔒 Core Memory: No                      │
├─────────────────────────────────────────┤
│ [⏪ Prev] [Next ⏩] [✏️ Edit] [🗑️ Del]  │
│ [🔒 Lock] [❌ Close]                    │
└─────────────────────────────────────────┘
```

**Dashboard Session**: Uses the existing `SessionManager` pattern:

- Tracks current memory index, filter state, total count
- Buttons update the session and refresh the embed
- 15-minute inactivity timeout (configurable)

**Search Integration**: `/memory search` returns results, clicking a result opens browser at that memory

### F8: Memory Editing

**Flow**:

1. User clicks [Edit] on a memory
2. Modal opens with current content in text field
3. User modifies content
4. On submit, regenerate embedding for new content
5. Update memory record

**Constraints**:

- Maximum 2000 characters (Discord modal limit)
- For longer memories, show truncated in modal with warning

### F9: Core Memory Locking

**Concept**: Mark important memories as "locked" - immune to bulk purge

```
/memory lock memory-id:abc123
```

**Behavior**:

- Locked memories shown with 🔒 indicator
- `/memory purge` skips locked memories
- Must explicitly unlock before purge affects them
- Useful for: important facts, preferences, relationship milestones

---

## Schema Migrations

### Migration 1: Context Epochs (STM)

```prisma
model UserPersonalityConfig {
  // ... existing fields

  // STM Epoch System
  lastContextReset     DateTime? @map("last_context_reset")
  previousContextReset DateTime? @map("previous_context_reset")  // For undo

  // Channel-specific epochs (JSONB for flexibility)
  channelEpochs        Json?     @map("channel_epochs")  // { channelId: timestamp }
}
```

### Migration 2: Memory Metadata Enhancement

```prisma
model Memory {
  // ... existing fields

  // Source tracking
  sourceType     String?   @map("source_type")    // "conversation", "import", "manual"
  sourceServerId String?   @map("source_server_id")
  sourceChannelId String?  @map("source_channel_id")

  // Privacy/management
  isLocked       Boolean   @default(false) @map("is_locked")  // Core memory protection
  visibility     String    @default("normal") @map("visibility")  // "normal", "hidden", "archived"

  // Timestamps
  updatedAt      DateTime? @updatedAt @map("updated_at")
}
```

### Migration 3: Incognito Sessions (Redis Only)

No Postgres migration needed - incognito state is ephemeral in Redis:

```typescript
// Redis key pattern
`incognito:${userId}:${personalityId}` // value: { startedAt, expiresAt }
`incognito:${userId}:all`; // global incognito
```

---

## Implementation Phases

### Phase 1: STM Management ✅ COMPLETE (beta.19)

**Goal**: Users can clear and restore conversation context

- [x] Add `lastContextReset`, `previousContextReset` to UserPersonalityConfig
- [x] Update conversation history queries to filter by epoch
- [x] Implement `/history clear` command
- [x] Implement `/history undo` command
- [x] Implement `/history hard-delete` with confirmation
- [x] Implement `/history view` command (later renamed to `/history stats`)
- [x] Add gateway routes for STM operations
- [x] Write tests for epoch filtering logic
- [x] Per-persona epoch tracking

### Phase 2: LTM Management (Current)

**Goal**: Users can search, browse, edit, and delete long-term memories

**2A: Memory Browser Dashboard** ✅ COMPLETE (PR #462)

_Prerequisite: Shared pagination utility for consistent UX across list commands_

- [x] Create shared pagination utility (`paginationBuilder.ts`)
  - [x] Generic button builder (◀ Previous | Page X of Y | Next ▶ | Sort toggle)
  - [x] Configurable custom ID prefixes
  - [x] Optional per-item action buttons
- [x] Refactor `/character list` and `/channel list` to use shared utility
- [x] Add `isLocked` field to memory schema
- [x] Implement `/memory list` command with pagination
- [x] Create `ListContext` type for navigation state
- [x] Build memory card embed component with metadata display (`buildDetailEmbed`)
- [x] Add [Edit] button → modal for editing memory content
- [x] Add [Delete] button → confirmation for single memory deletion
- [x] Add [Lock/Unlock] button → toggle core memory protection
- [x] Regenerate embeddings on edit (via EmbeddingService)
- [x] Enhance `/memory search` with pagination (same shared utility)
- [ ] Build autocomplete for server/channel name resolution (deferred - optional enhancement)
- [ ] Add source tracking fields (`sourceServerId`, `sourceChannelId`) (deferred - optional enhancement)

**2B: Memory Search** ✅ COMPLETE (PR #462)

- [x] Implement `/memory search` with semantic search via pgvector
- [x] Add text search fallback when semantic returns no results
- [x] Show `searchType` indicator (semantic vs text match)
- [x] Search results show numbered list with select menu
- [x] Selecting memory opens detail view with edit/delete/lock actions

**2C: Batch Operations** ✅ COMPLETE (PR #471)

- [x] Implement `/memory delete` for batch deletion with filters
- [x] Implement `/memory purge` with typed confirmation modal
- [ ] Add isLocked check to batch operations (skip locked memories) — deferred to Phase 4
- [x] Implement `/memory stats` for memory statistics ✅ COMPLETE (beta.41)

**2D: Memory Read Toggle ("Focus Mode")** ✅ COMPLETE

- [x] Add `focusModeEnabled` boolean to UserPersonalityConfig
- [x] Implement `/memory focus` toggle (enable/disable via POST body)
- [x] Implement `/memory focus` GET - check current state
- [x] Show focus mode status in `/memory stats` output
- [x] Add focus mode check to RAG retrieval pipeline (ai-worker) — `MemoryRetriever.ts:137`
- [x] Visual indicator in responses when focus mode is active — `🔒 Focus Mode • LTM retrieval disabled`

**UX Distinction**:

- 🛑 **Incognito** ("Stop Recording") = Disable LTM **writing** (new memories not saved)
- 🔒 **Focus Mode** = Disable LTM **reading** (existing memories not retrieved)

Focus Mode is useful when users want the personality to respond without referencing past memories - like a "fresh start" without deleting anything.

### Phase 3: Incognito Mode (`/memory incognito`)

**Goal**: Users can temporarily disable LTM recording for privacy

- [ ] Create Redis-based incognito session manager
- [ ] Implement `/memory incognito enable` with duration options
- [ ] Implement `/memory incognito disable`
- [ ] Implement `/memory incognito status`
- [ ] Add incognito check to memory storage flow
- [ ] Add visual indicator to responses when incognito
- [ ] Implement `/memory incognito forget` (retroactive delete)

### Phase 4: Polish & Edge Cases

**Goal**: Complete UX polish and handle edge cases

- [ ] Implement date range filtering for all operations
- [ ] Polish all confirmation modals
- [ ] Add audit logging for destructive operations
- [ ] Comprehensive E2E testing
- [ ] Documentation and help text

---

## UX Patterns

### Destructive Operation Confirmation Flow

**Level 1 - Simple Confirm** (single memory delete):

```
┌─────────────────────────────────────────┐
│ ⚠️ Delete Memory?                       │
│                                         │
│ Are you sure you want to delete this    │
│ memory? This cannot be undone.          │
│                                         │
│ [Cancel]  [🗑️ Delete]                   │
│             ↑ Red button                │
└─────────────────────────────────────────┘
```

**Level 2 - Modal Warning** (bulk purge):

```
┌─────────────────────────────────────────┐
│ ⚠️ DANGER: Purge All Memories           │
├─────────────────────────────────────────┤
│ This will permanently delete 47         │
│ memories for Lilith. This action        │
│ CANNOT be undone.                       │
│                                         │
│ Type "DELETE LILITH MEMORIES" to        │
│ confirm:                                │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Cancel]  [☢️ Delete Forever]           │
└─────────────────────────────────────────┘
```

### Memory Mode Visual Indicators

See command structure section for visual indicators:

- **Focus Mode**: 🔒 indicator when LTM reading is disabled
- **Incognito Mode**: 👻 indicator when LTM writing is disabled

### Memory Search Results

```
┌─────────────────────────────────────────┐
│ 🔍 Search Results: "pizza"              │
│ Found 3 memories                        │
├─────────────────────────────────────────┤
│ 1️⃣ "User loves pepperoni pizza from    │
│    Joe's Pizza on 5th Street..."        │
│    📅 3 days ago • 🎭 Lilith            │
│                                         │
│ 2️⃣ "Had a long conversation about      │
│    whether pineapple belongs on..."     │
│    📅 1 week ago • 🎭 Lilith            │
│                                         │
│ 3️⃣ "User mentioned their pizza order   │
│    for the party was cancelled..."      │
│    📅 2 weeks ago • 🎭 Sarcastic        │
├─────────────────────────────────────────┤
│ [View 1️⃣] [View 2️⃣] [View 3️⃣] [New 🔍] │
└─────────────────────────────────────────┘
```

---

## API Routes

### Gateway Routes (New)

**STM (History) Routes:**

| Method | Route                 | Description                           |
| ------ | --------------------- | ------------------------------------- |
| POST   | `/user/history/clear` | Set context epoch                     |
| POST   | `/user/history/undo`  | Restore previous epoch                |
| DELETE | `/user/history`       | Hard delete (with confirmation token) |
| GET    | `/user/history/stats` | Get conversation statistics           |

**LTM (Memory) Routes:**

| Method | Route                   | Description                                  |
| ------ | ----------------------- | -------------------------------------------- |
| POST   | `/user/memory/search`   | Semantic memory search                       |
| GET    | `/user/memory/list`     | Paginated memory list (for browse dashboard) |
| GET    | `/user/memory/:id`      | Get single memory                            |
| PATCH  | `/user/memory/:id`      | Update memory content + regenerate embedding |
| DELETE | `/user/memory/:id`      | Delete single memory                         |
| POST   | `/user/memory/delete`   | Batch delete with filters                    |
| POST   | `/user/memory/purge`    | Delete all (with typed confirmation)         |
| POST   | `/user/memory/:id/lock` | Lock memory (core memory)                    |
| DELETE | `/user/memory/:id/lock` | Unlock memory                                |
| GET    | `/user/memory/stats`    | Memory statistics                            |

**Focus Mode Routes (Read Toggle):**

| Method | Route                | Description           |
| ------ | -------------------- | --------------------- |
| POST   | `/user/memory/focus` | Enable focus mode     |
| DELETE | `/user/memory/focus` | Disable focus mode    |
| GET    | `/user/memory/focus` | Get focus mode status |

**Incognito Routes (Write Toggle):**

| Method | Route                           | Description          |
| ------ | ------------------------------- | -------------------- |
| POST   | `/user/memory/incognito`        | Enable incognito     |
| DELETE | `/user/memory/incognito`        | Disable incognito    |
| GET    | `/user/memory/incognito`        | Get incognito status |
| POST   | `/user/memory/incognito/forget` | Retroactive delete   |

**Note**: Browse dashboard session state is managed client-side (in bot-client) using the `SessionManager` pattern, not via API. Only data fetching goes through gateway.

### Confirmation Token Pattern

For destructive operations, use two-step flow:

1. **Request confirmation**: `POST /user/memory/purge/request`
   - Returns `{ confirmationToken, expiresAt, affectedCount }`
   - Token valid for 5 minutes

2. **Execute with token**: `POST /user/memory/purge`
   - Body: `{ confirmationToken, typedPhrase? }`
   - Validates token and phrase before executing

---

## Security Considerations

### Rate Limiting

- Destructive operations: 5 per hour
- Memory search: 30 per minute
- Memory browse: 60 per minute

### Audit Logging

Log all destructive operations:

```typescript
interface MemoryAuditLog {
  userId: string;
  action: 'purge' | 'hard-delete' | 'edit' | 'delete';
  targetCount: number;
  filters: object;
  timestamp: Date;
  // Don't log actual content for privacy
}
```

### Data Validation

- Verify user owns memories before any operation
- Validate personality/persona access
- Server/channel ID validation against user's accessible servers

---

## Future Enhancements (Icebox)

### Memory Consolidation

Summarize STM into condensed LTM entries (like "sleeping on it"):

- End of day consolidation job
- Keep important facts, discard noise
- User-triggered consolidation option

### Facts vs Vibes Separation

Semantic categorization of memories:

- **Facts**: User's name, preferences, important dates
- **Vibes**: Emotional context, relationship dynamics
- Different retention policies for each

### Memory Sharing

Allow users to share specific memories between personalities:

- "Copy this memory to all characters"
- "This fact applies to everyone"

### Memory Export

Download all memories as JSON/CSV:

- For data portability
- For backup purposes
- GDPR compliance

---

## References

- [ADR-003: Context Epochs](./SLASH_COMMAND_ARCHITECTURE.md#adr-003-context-epochs-for-history-reset)
- [ADR-005: Memory Management](./SLASH_COMMAND_ARCHITECTURE.md#adr-005-memory-management-via-semantic-search)
- [Memory Architecture](../architecture/memory-and-context-redesign.md)
- [V2 Feature Tracking](./V2_FEATURE_TRACKING.md)
