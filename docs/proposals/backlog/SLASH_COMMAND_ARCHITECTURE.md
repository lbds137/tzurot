# Slash Command Architecture Redesign

> **Status**: Planning Phase
> **Created**: 2025-12-11
> **Last Updated**: 2025-12-11
> **Estimated Sessions**: 8-12

## Executive Summary

This document outlines a comprehensive redesign of Tzurot's slash command system to:

1. Standardize UX patterns across all entity management commands
2. Unify the dashboard framework for complex data editing
3. Consolidate alias-based personality tagging
4. Enable user self-service for history and memory management
5. Prepare for shapes.inc data import functionality

## Table of Contents

1. [Design Principles](#design-principles)
2. [Dashboard Pattern Specification](#dashboard-pattern-specification)
3. [Architectural Decisions](#architectural-decisions)
4. [Entity Command Coverage](#entity-command-coverage)
5. [Implementation Phases](#implementation-phases)
6. [Schema Migrations Required](#schema-migrations-required)
7. [API Route Naming Convention](#api-route-naming-convention)

---

## Design Principles

### 1. Configuration Over Code

All dashboard UIs are defined declaratively via `DashboardConfig<T>`. Handlers are generic.

### 2. Single Source of Truth

- Aliases table is THE lookup mechanism for personality tagging
- Slug and displayName auto-create aliases on personality creation
- All @mention resolution goes through aliases only

### 3. Scoped Resources Pattern

Resources can exist at multiple scopes with cascading precedence:

```
USER > GUILD > GLOBAL
```

User settings override guild settings, which override global defaults.

### 4. Semantic Search Over Pagination

For large datasets (memories), use pgvector semantic search rather than pagination.

```
/memory search query:"conversation about pizza"
```

### 5. Context Epochs for History Management

Instead of deleting or inserting barrier records, use timestamps:

```sql
last_context_reset TIMESTAMP  -- On UserPersonalityConfig or similar
-- Query: WHERE created_at > last_context_reset
```

### 6. Admin as Scope, Not Separate Commands

Admin operations use the same command groups with scope parameter:

```
/preset create scope:[User | Global (Admin)]
/alias add scope:[User | Global (Admin)]
```

Hide admin options from non-admins in autocomplete.

---

## Dashboard Pattern Specification

### Tier System

| Tier       | Criteria              | UX Pattern                    | Example Commands                  |
| ---------- | --------------------- | ----------------------------- | --------------------------------- |
| **Tier 0** | 1-2 fields            | Inline command options        | `/alias add`, `/history clear`    |
| **Tier 1** | 3-5 fields            | Single modal                  | `/admin system-prompt create`     |
| **Tier 2** | 6+ fields OR sections | Full dashboard                | `/character edit`, `/preset edit` |
| **Tier 3** | Large datasets        | Semantic search + detail view | `/memory search`                  |

### Tier 2 Dashboard Components

```
┌─────────────────────────────────────────────┐
│ 📝 Editing: [Entity Name]                   │
│ Description/metadata line                    │
├─────────────────────────────────────────────┤
│ 🏷️ Section 1 ✅                             │
│   Preview of section data...                 │
│                                              │
│ 📖 Section 2 ⚠️                             │
│   Preview of section data...                 │
│                                              │
│ ❤️ Section 3 🔧                             │
│   Not configured                             │
├─────────────────────────────────────────────┤
│ [Select a section to edit... ▼]             │
│ [🔄 Refresh] [👁️ Toggle] [❌ Close]         │
└─────────────────────────────────────────────┘
```

### Status Indicators

- ✅ `COMPLETE` - All required fields filled
- ⚠️ `PARTIAL` - Some required fields missing
- 🔧 `DEFAULT` - Optional section, using defaults
- ❌ `EMPTY` - Required section, no data

### Session Management

**Current**: In-memory `SessionManager` (single replica only)

**Target**: Redis-backed sessions for horizontal scaling

```typescript
interface SessionStorage {
  get(key: string): Promise<DashboardSession | null>;
  set(key: string, session: DashboardSession, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// Implementations
class MemorySessionStorage implements SessionStorage { ... }
class RedisSessionStorage implements SessionStorage { ... }
```

---

## Architectural Decisions

### ADR-001: Aliases as Single Source of Truth

**Context**: Personality tagging currently checks slug, displayName, and aliases with complex priority logic.

**Decision**: All tagging resolves through the `personality_aliases` table only.

**Implementation**:

1. On personality creation, auto-create aliases for `slug` and `displayName`
2. On personality rename, update corresponding alias
3. Remove direct slug/displayName lookup from tagging logic
4. Add `priority` column for resolution order (User > Guild > Global)

**Schema**:

```prisma
model PersonalityAlias {
  id            String      @id @default(uuid())
  alias         String      @db.VarChar(100)
  personalityId String      @map("personality_id")
  scopeType     String      @default("GLOBAL") @map("scope_type") // GLOBAL, GUILD, USER
  scopeId       String?     @map("scope_id") // null for GLOBAL, guildId or discordUserId
  isAutoCreated Boolean     @default(false) @map("is_auto_created") // true for slug/displayName aliases
  createdAt     DateTime    @default(now())
  personality   Personality @relation(...)

  @@unique([alias, scopeType, scopeId])
  @@index([alias])
  @@index([scopeId])
}
```

**Gotchas**:

- Cache invalidation on personality rename
- Show alias source in autocomplete: `> Batman (Global)` vs `> Batman (Your Custom)`

---

### ADR-002: Scoped Resources Pattern

**Context**: Multiple entities need global vs user-specific variants (LlmConfig, Aliases, future SystemPrompt).

**Decision**: Use scope enum + nullable scopeId, with cascading resolution.

**Pattern**:

```typescript
enum ResourceScope {
  GLOBAL = 'GLOBAL', // scopeId = null
  GUILD = 'GUILD', // scopeId = guildId
  USER = 'USER', // scopeId = discordUserId
}

// Resolution order: USER > GUILD > GLOBAL
async function resolveConfig(userId: string, guildId: string | null): Promise<Config> {
  const configs = await prisma.config.findMany({
    where: {
      OR: [
        { scopeType: 'USER', scopeId: userId },
        { scopeType: 'GUILD', scopeId: guildId },
        { scopeType: 'GLOBAL' },
      ],
    },
  });
  // Return highest priority match
  return (
    configs.find(c => c.scopeType === 'USER') ??
    configs.find(c => c.scopeType === 'GUILD') ??
    configs.find(c => c.scopeType === 'GLOBAL')
  );
}
```

---

### ADR-003: Context Epochs for History Reset

**Context**: Users want to "reset" conversation history without losing data.

**Decision**: Use timestamp-based epochs instead of deletion or barrier records.

**Implementation**:

```prisma
model UserPersonalityConfig {
  // ... existing fields
  lastContextReset  DateTime?  @map("last_context_reset")
}
```

**Query**:

```sql
SELECT * FROM conversation_history
WHERE personality_id = $1
  AND persona_id = $2
  AND channel_id = $3
  AND created_at > COALESCE(
    (SELECT last_context_reset FROM user_personality_configs WHERE ...),
    '1970-01-01'
  )
ORDER BY created_at DESC
LIMIT $4
```

**Benefits**:

- No dummy records cluttering the table
- Simple indexed timestamp comparison
- Easy "undo" by moving timestamp back
- Full audit trail preserved

---

### ADR-004: Temporary Credential Storage (shapes.inc)

**Context**: shapes.inc import requires user's appSession cookie temporarily.

**Decision**: Redis with encryption + TTL, immediate deletion on completion.

**Flow**:

1. User provides cookie via ephemeral modal
2. Encrypt with AES-256-GCM, store in Redis: `shapes_import:{userId}`
3. Set TTL: 15 minutes (configurable)
4. Start background import job
5. Job retrieves, decrypts, uses, and **deletes key immediately on completion**
6. Progress stored in Redis for UI updates

**Security**:

- Encrypted at rest in Redis
- Auto-expires if job fails/stalls
- Explicit deletion on success
- Never logged or persisted to PostgreSQL

---

### ADR-005: Memory Management via Semantic Search

**Context**: Users may have thousands of memories. Pagination in Discord is poor UX.

**Decision**: Primary interface is semantic search using pgvector.

**Commands**:

```
/memory search query:"conversation about pizza"
/memory list [personality] [page]  -- fallback pagination
/memory delete <memory_id>
/memory edit <memory_id>           -- opens modal
/memory purge timeframe:[1h|24h|7d|all] [personality]
```

**Search Flow**:

1. Generate embedding for user's query
2. pgvector cosine similarity search
3. Return top 5 matches as embed
4. Each result has [View Full] [Edit] [Delete] buttons

**Future Enhancement**: Text search autocomplete for filtering before semantic search.

---

## Entity Command Coverage

### User Commands

| Command Group        | Subcommands                                              | Tier | Status          |
| -------------------- | -------------------------------------------------------- | ---- | --------------- |
| `/character`         | create, edit, view, list, delete, avatar, export, import | 2    | ✅ Done         |
| `/persona`           | create, edit, view, browse, default, share-ltm, override | 2    | ✅ Done         |
| `/settings preset`   | set, clear                                               | 0-1  | ✅ Done         |
| `/settings timezone` | get, set                                                 | 0    | ✅ Done         |
| `/preset`            | create, **edit**, list, delete, scope:[User\|Global]     | 2    | ⚠️ Missing edit |
| `/alias`             | add, remove, list, scope:[User\|Global]                  | 0    | ❌ New          |
| `/history`           | clear, undo, stats                                       | 0-1  | ❌ New          |
| `/memory`            | search, list, edit, delete, purge, stats                 | 3    | ❌ New          |
| `/wallet`            | add, remove, list, balance                               | 1    | ✅ Done         |

### Admin-Only Operations (via scope parameter or separate)

| Command                       | Operation               | Implementation                              |
| ----------------------------- | ----------------------- | ------------------------------------------- |
| `/preset create scope:Global` | Create global preset    | Scope parameter                             |
| `/alias add scope:Global`     | Create global alias     | Scope parameter                             |
| `/admin system-prompt`        | CRUD for system prompts | Separate (entity doesn't need user variant) |
| `/admin servers`              | List/kick servers       | Separate (system operation)                 |
| `/admin usage`                | View usage stats        | Separate (system operation)                 |
| `/admin db-sync`              | Database sync           | Separate (system operation)                 |

---

## Implementation Phases

### Phase 0: Foundation (Sessions 1-2)

**Goal**: Enable horizontal scaling and document patterns

- [ ] Abstract SessionManager behind interface
- [ ] Implement RedisSessionStorage
- [ ] Add config flag: `SESSION_STORAGE=memory|redis`
- [ ] Document dashboard pattern specification (this doc)
- [ ] Create reusable components for Tier 3 (search + detail)

### Phase 1: User Self-Service (Sessions 3-5)

**Goal**: Users can manage their own data

- [ ] `/preset edit` dashboard (Tier 2)
- [ ] `/persona` upgrade to dashboard framework
- [ ] `/history clear` with soft/hard modes (Context Epochs)
- [ ] `/history undo` (move epoch timestamp back)
- [ ] `/memory search` semantic search (Tier 3)
- [ ] `/memory purge` bulk deletion

### Phase 2: Alias Consolidation (Sessions 6-7)

**Goal**: Single source of truth for tagging

- [ ] Schema migration: Add scopeType, scopeId, isAutoCreated to PersonalityAlias
- [ ] Auto-create aliases on personality create/rename
- [ ] Refactor tagging logic to use aliases only
- [ ] `/alias add/remove/list` commands
- [ ] Update autocomplete to show alias source

### Phase 3: Admin & Advanced (Sessions 8-9)

**Goal**: Admin tools and advanced parameters

- [ ] `/admin system-prompt` CRUD
- [ ] Complete advancedParameters migration
- [ ] `/preset edit` advanced params section
- [ ] API route naming audit and refactor

### Phase 4: Shapes Import (Sessions 10-12)

**Goal**: Import legacy data from shapes.inc

- [ ] Redis credential storage with TTL
- [ ] `/shapes backup` - Export shapes.inc data (like v2)
- [ ] `/shapes import` wizard - Selective import
- [ ] Ownership validation via shapes profile UUID
- [ ] Progress tracking and resumable imports
- [ ] ShapesPersonaMapping for memory attribution

---

## Schema Migrations Required

### Migration 1: PersonalityAlias Scoping

```prisma
model PersonalityAlias {
  // Existing
  id            String      @id @default(uuid())
  alias         String      @db.VarChar(100)
  personalityId String      @map("personality_id")

  // New
  scopeType     String      @default("GLOBAL") @map("scope_type")
  scopeId       String?     @map("scope_id")
  isAutoCreated Boolean     @default(false) @map("is_auto_created")

  // Updated constraint
  @@unique([alias, scopeType, scopeId])
}
```

### Migration 2: Context Epochs

```prisma
model UserPersonalityConfig {
  // Existing fields...

  // New
  lastContextReset DateTime? @map("last_context_reset")
}
```

### Migration 3: LlmConfig Scope (Optional, for Guild support)

```prisma
model LlmConfig {
  // Existing fields...

  // Replace isGlobal + ownerId with:
  scopeType String  @default("GLOBAL") @map("scope_type")
  scopeId   String? @map("scope_id")
}
```

---

## API Route Naming Convention

### Current Issues

- Inconsistent naming: `/user/llm-config` vs `/user/persona`
- Admin routes separate from entity routes

### Proposed Convention

```
/api/{scope}/{entity}/{action?}

Scope: user, admin, internal
Entity: personality, preset, alias, persona, history, memory, system-prompt
Action: optional verb for non-CRUD operations
```

### Route Mapping

| Current             | Proposed               | Notes              |
| ------------------- | ---------------------- | ------------------ |
| `/user/llm-config`  | `/user/preset`         | Match command name |
| `/user/personality` | `/user/character`      | Match command name |
| `/admin/llm-config` | `/admin/preset`        | Consistency        |
| -                   | `/user/alias`          | New                |
| -                   | `/user/history`        | New                |
| -                   | `/user/memory`         | New                |
| -                   | `/admin/system-prompt` | New                |

---

## Open Questions

1. **Guild-scoped resources**: Do we need guild-level configs now, or defer?
2. **Memory edit UI**: Modal for text, or magic link to web UI?
3. **Shapes import chunking**: How to handle users with 10k+ memories?
4. **Advanced params UI**: Full dashboard or simplified "presets"?

---

## Known Technical Debt (Half-Baked Features)

These are features that exist in schema/code but aren't fully wired up:

| Feature                 | Current State                                      | What's Missing                                  |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------- |
| **Memory scope**        | Schema has `canonScope`, `sessionId` fields        | Not used in queries, no UI                      |
| **Advanced LLM params** | `AdvancedParamsSchema` exists, JSONB column exists | No API routes, no UI, legacy columns still used |
| **Persona share LTM**   | `shareLtmAcrossPersonalities` field exists         | Logic not implemented                           |
| **Voice settings**      | `voiceSettings` JSONB exists                       | No structured schema, no UI                     |
| **Image settings**      | `imageSettings` JSONB exists                       | No structured schema, no UI                     |
| **Custom fields**       | `customFields` JSONB on Personality                | Never used                                      |

**Strategy**: Address these incrementally as part of Sprint 7 phases, not all at once.

---

## References

- [Dashboard Framework](../../services/bot-client/src/utils/dashboard/)
- [Character Command](../../services/bot-client/src/commands/character/) - Gold standard
- [Advanced Params Schema](../../packages/common-types/src/schemas/llmAdvancedParams.ts)
- [V2 Feature Tracking](./V2_FEATURE_TRACKING.md)
