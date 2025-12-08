# Shapes.inc Migration Reference

> **Created**: 2025-12-08
> **Status**: Quick Reference (Future Implementation)
> **Purpose**: High-level overview of shapes.inc migration concepts
>
> **Detailed Implementation Docs**:
>
> - **[SHAPES_INC_IMPORT_PLAN.md](SHAPES_INC_IMPORT_PLAN.md)** - Detailed implementation guide (field mappings, UUID mapping workflow, code examples, CLI usage, edge cases, testing, rollback)
> - **[SHAPES_INC_SLASH_COMMAND_DESIGN.md](../planning/SHAPES_INC_SLASH_COMMAND_DESIGN.md)** - User-facing `/import shapes` command design
>
> **Reference Code**:
>
> - V2 Backup Script: `tzurot-legacy/scripts/backup-personalities-data.js`
> - V3 Import Scripts: `scripts/data/import-personality/`

## Overview

Shapes.inc was Tzurot v2's AI provider. They killed their public bot API in September 2025, forcing the v3 rewrite. However, their internal APIs still work with user session cookies, enabling data migration for users who want to import their personalities.

This document provides a quick reference. For detailed implementation, see [SHAPES_INC_IMPORT_PLAN.md](SHAPES_INC_IMPORT_PLAN.md).

---

## Table of Contents

1. [Data Structure Analysis](#1-data-structure-analysis)
2. [Storage Architecture](#2-storage-architecture)
3. [UUID Mapping System](#3-uuid-mapping-system)
4. [LTM Memory Handling](#4-ltm-memory-handling)
5. [Import Process](#5-import-process)
6. [Scripts Reference](#6-scripts-reference)

---

## 1. Data Structure Analysis

### Shapes.inc Export Format

Each personality in shapes.inc has multiple JSON files:

```
personality-slug/
├── personality-slug.json              # Core config (~400 lines)
├── personality-slug_chat_history.json # Raw conversations (~40K lines)
├── personality-slug_memories.json     # LTM summaries (~230K lines)
├── personality-slug_knowledge.json    # Background lore/docs (~100 lines)
└── personality-slug_user_personalization.json  # Per-user overrides (~20 lines)
```

### Memory Structure

```typescript
interface ShapesIncMemory {
  id: string; // Composite: msgId1/msgId2
  shape_id: string; // Personality UUID
  senders: string[]; // Participant UUIDs
  result: string; // LTM summary text
  metadata: {
    msg_ids: string[]; // Source message UUIDs
    start_ts: number;
    end_ts: number;
    discord_channel_id?: string;
  };
}
```

### Personality Config Mapping

```typescript
interface ShapesIncPersonality {
  id: string; // UUID from shapes.inc
  user_id: string[]; // Array of owner UUIDs
  duplicate_shape_ids: string[]; // Related personality variants
  // ... 400+ lines of config
}

// Maps to Tzurot v3 schema
interface TzurotPersonality {
  id: string; // Keep shapes.inc UUID
  ownerId: string; // Single owner (Discord ID)
  // ... simplified schema
}
```

### Data Sizes (Example: Lilith personality)

- Main config: 403 lines, extensive jailbreak/prompts
- Memories: 231K lines, ~36MB
- Chat history: 40K lines, ~7MB
- Knowledge: 111 lines, background documents

---

## 2. Storage Architecture

### PostgreSQL (Relational Data)

- Core personality configuration
- UUID-based identity system
- User ownership (many-to-many via `personality_owners`)
- Per-user personality customization
- Activated channels
- Persistent conversation history
- Voice/image generation settings

### pgvector (Vector/Semantic Data)

- Long-term memories (LTM) with embeddings
- Knowledge documents
- Historical chat for RAG retrieval
- Semantic search capabilities

### In-Memory (Ephemeral)

- Recent conversation context (last N messages)
- Active sessions

---

## 3. UUID Mapping System

### The Problem

When importing personalities from shapes.inc exports, the memory data contains old user UUIDs that don't match current Postgres user IDs. This creates "orphaned" memories that can't be migrated to persona-scoped collections.

### Solution

The import scripts support UUID mappings via `scripts/uuid-mappings.json`. When processing memories:

1. Load UUID mappings from JSON file
2. Replace old shapes.inc UUIDs with current Postgres UUIDs
3. Consolidate all memories under the current user's persona

**For detailed workflow, tools, and options for handling unknown users**, see the [UUID Mapping Operational Workflow](SHAPES_INC_IMPORT_PLAN.md#uuid-mapping-operational-workflow) section in the Import Plan.

---

## 4. LTM Memory Handling

### The Decision: Trust Existing LTM or Regenerate?

shapes.inc exports contain:

- **Chat History**: Raw conversation messages (40K lines)
- **Memories**: AI-generated LTM summaries (231K lines)
- **Relationship**: Memories have UUIDs linking to chat messages they summarize

### Option A: Trust Existing LTM (Recommended Initially)

**Approach:**

- Import memories as-is
- Ignore chat history entirely
- Assume shapes.inc LTM generation was sufficient

**Pros:**

- Faster migration
- Preserves exact historical context
- No re-processing overhead
- Maintains continuity with shapes.inc experience

**Cons:**

- shapes.inc LTM quality unknown
- Can't improve summary quality
- Locked into their chunking/timing decisions

### Option B: Regenerate LTM

**Approach:**

- Cross-reference memories ↔ chat history
- Regenerate LTM using Tzurot's own prompts/chunking
- Use modern models (Gemini 2.5, etc.)

**Pros:**

- Consistent LTM quality across all personalities
- Control over chunking/summarization strategy
- Opportunity to improve on original summaries

**Cons:**

- Extremely expensive (40K messages × API cost)
- Time-consuming processing
- May lose nuance from original summaries

### Option C: Hybrid Approach (Future Enhancement)

- Import existing memories for bulk of history
- Identify gaps where chat exists but no LTM
- Only regenerate for missing summaries or low-quality ones

### Current Recommendation

**Phase 1 (Now):** Option A - Import existing LTM as-is for immediate functionality

**Phase 2 (Future):** Option C - Selective regeneration for recent conversations

---

## 5. Import Process

### Manual Process (Current)

1. Run v2 backup script with shapes.inc session cookie
2. Run v3 import script for personality config
3. Run v3 import script for memories
4. Manually update UUID mappings
5. Run migration scripts for orphaned data

### Automated Process (Future: `/import shapes`)

See [SHAPES_INC_SLASH_COMMAND_DESIGN.md](../planning/SHAPES_INC_SLASH_COMMAND_DESIGN.md) for the full slash command design.

### Data Mapping Priorities

**High Priority (Phase 1):**

- Core personality config
- User ownership
- User personalization
- LTM memories

**Medium Priority (Phase 2):**

- Knowledge documents
- Voice settings (for future)
- Image generation settings

**Low Priority (Later):**

- X/Twitter integration
- Custom HTML/CSS
- Discovery/search tags
- Credits/usage tracking

---

## 6. Scripts Reference

### V2 Scripts (tzurot-legacy)

| Script                                   | Purpose                      | Status     |
| ---------------------------------------- | ---------------------------- | ---------- |
| `scripts/backup-personalities-data.js`   | Fetch data from shapes.inc   | Standalone |
| `docs/external-services/SHAPES_INC_*.md` | API documentation (archived) | Reference  |

### V3 Scripts (scripts/data/import-personality)

| Script                      | Purpose                          | Status           |
| --------------------------- | -------------------------------- | ---------------- |
| `import-personality.ts`     | Main CLI orchestrator            | Production-ready |
| `PersonalityMapper.ts`      | Map shapes.inc → v3 schema       | Production-ready |
| `MemoryImporter.ts`         | Import LTM to pgvector           | Production-ready |
| `bulk-import.ts`            | Batch import multiple            | Production-ready |
| `migrate-legacy-persona.ts` | Migrate orphaned memories        | Production-ready |
| `AvatarDownloader.ts`       | Download avatars from shapes.inc | Production-ready |

### Utility Scripts

| Script                             | Purpose                         |
| ---------------------------------- | ------------------------------- |
| `scripts/analyze-qdrant-users.cjs` | List Qdrant userIds vs Postgres |
| `scripts/find-user-memories.cjs`   | Search memories by content      |
| `scripts/uuid-mappings.json`       | UUID mapping configuration      |

---

## Open Questions

1. **Voice Integration**: shapes.inc uses ElevenLabs - do we want to support that or abstract it?
2. **Image Generation**: shapes.inc uses various models - same question
3. **Conversation Chunking**: What's shapes.inc's LTM chunking strategy? (appears to be ~5 messages)
4. **Free Will System**: shapes.inc has "free_will_level" - relevant for Tzurot?

---

## References

- Example personality data: `tzurot-legacy/data/personalities/lilith-tzel-shani/`
- V3 Import Progress: `scripts/data/import-personality/PROGRESS.md`
- Session Summary: `scripts/data/import-personality/SESSION_SUMMARY.md`

---

## Changelog

- **2025-12-08**: Consolidated from multiple docs into single reference
- **2025-11-17**: Original docs created
- **2025-01-27**: Import plan design phase started
