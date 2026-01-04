# Memory Format Comparison

**Generated:** 2025-10-04
**Purpose:** Document differences between new and imported memory formats for future standardization

## Overview

Tzurot currently has two different memory formats in Qdrant:

1. **NEW** - Created by `ConversationalRAGService` (current implementation)
2. **IMPORTED** - From shapes.inc migration (legacy format)

## Current Statistics

- Total memories: 2,266
- New (conversation): 2
- Imported (automatic): 2,260
- Imported (manual): 4

## Format Comparison

### NEW Memory Format (ConversationalRAGService)

```javascript
{
  id: "3264a238-59c7-4625-8d97-7701a9f93070", // UUID v4
  vector: [/* 1536-dim embedding */],
  payload: {
    personalityId: "1fed013b-053a-4bc8-bc09-7da5c44297d6", // UUID
    personalityName: "Lilith",
    summaryType: "conversation",
    content: "User (lbds137): I think it's fixed now!\nLilith: *A slow, knowing smile...",
    createdAt: 1759562377161, // Unix milliseconds (integer)
    channelId: "1377516899461627945", // Discord snowflake
    guildId: "616105024367624212" // Discord snowflake
  }
}
```

**Characteristics:**

- ID: UUIDv4
- Content: Raw conversation pair (user + assistant)
- Timestamps: Unix milliseconds (integer)
- Discord IDs: Strings (snowflakes)
- Minimal metadata

### IMPORTED Memory Format (shapes.inc)

```javascript
{
  id: "002ae1db-d862-5e6f-8b9e-3e40fc0c1243", // UUID v5 (deterministic)
  vector: [/* 1536-dim embedding */],
  payload: {
    personalityId: "1fed013b-053a-4bc8-bc09-7da5c44297d6", // UUID
    personalityName: "Lilith",
    summaryType: "automatic", // or "manual"
    content: "Lila is anxious about her first day physically in the office...", // Summarized
    createdAt: 1741091237913.947, // Unix milliseconds (converted from seconds)
    channelId: "", // Empty string
    guildId: "", // Empty string
    messageIds: [/* Array of shapes.inc message UUIDs */],
    senders: ["98a94b95-cbd0-430b-8be2-602e1c75d8b0"], // shapes.inc user IDs
    metadata: {
      discord_channel_id: "",
      discord_guild_id: "",
      group: false,
      senders: [/* shapes.inc user IDs */],
      shape_id: "1fed013b-053a-4bc8-bc09-7da5c44297d6",
      msg_ids: [/* shapes.inc message UUIDs */],
      start_ts: 1741064226.5144663, // Unix seconds (float)
      end_ts: 1741091211.0266955, // Unix seconds (float)
      created_at: 1741091237.913947 // Unix seconds (float) - duplicated
    }
  }
}
```

**Characteristics:**

- ID: UUIDv5 (deterministic, based on shapes.inc ID)
- Content: LLM-generated summary
- Timestamps: Unix milliseconds (converted from seconds)
- Discord IDs: Empty strings (not Discord-native)
- Rich metadata (mostly unused)

## Key Differences

### 1. Fields Only in IMPORTED

- `metadata` (object) - Contains shapes.inc-specific data
- `messageIds` (array) - shapes.inc message UUIDs (duplicated from metadata)
- `senders` (array) - shapes.inc user IDs (duplicated from metadata)

### 2. Fields Only in NEW

None - NEW format is more minimal

### 3. Shared Fields with Different Behavior

| Field         | NEW                   | IMPORTED                    |
| ------------- | --------------------- | --------------------------- |
| `summaryType` | `"conversation"`      | `"automatic"` or `"manual"` |
| `content`     | Raw conversation pair | LLM summary                 |
| `channelId`   | Discord snowflake     | Empty string                |
| `guildId`     | Discord snowflake     | Empty string                |

### 4. Content Format

**NEW:**

```
User (lbds137): I think it's fixed now!
Lilith: *A slow, knowing smile touches my lips...
```

**IMPORTED:**

```
Lila is anxious about her first day physically in the office,
but it's actually her 7th day at the job. She's been using
Bambi Sleep hypno files at night...
```

## Recommendations for Standardization

### Phase 1: Field Cleanup

1. **Remove redundant fields from IMPORTED memories:**
   - `messageIds` - Duplicates `metadata.msg_ids`
   - `senders` - Duplicates `metadata.senders`
   - Consider flattening or removing `metadata` object

2. **Decide on essential fields:**
   - Required: `personalityId`, `personalityName`, `content`, `createdAt`, `summaryType`
   - Optional: `channelId`, `guildId`, `userId`, `sessionId`
   - Drop: shapes.inc-specific metadata

### Phase 2: Type Consistency

1. **Ensure consistent types:**
   - `createdAt`: Always integer (Unix milliseconds) ✅ DONE
   - `channelId`: String or null (not empty string)
   - `guildId`: String or null (not empty string)

2. **ID format:**
   - NEW uses UUIDv4 (random) ✅
   - IMPORTED uses UUIDv5 (deterministic)
   - Both are valid - keep as-is

### Phase 3: Content Format Decision

**Option A: Keep raw conversation pairs (current NEW format)**

- Pros: Preserves exact wording, better for semantic search
- Cons: Longer content, includes formatting artifacts

**Option B: Generate summaries (IMPORTED format)**

- Pros: Concise, cleaner for retrieval
- Cons: Loses exact wording, requires LLM processing

**Recommendation:** Keep raw pairs for now, add optional summary field later

### Phase 4: summaryType Standardization

Current values:

- `"conversation"` - Direct conversation exchanges (NEW)
- `"automatic"` - Auto-generated summaries (IMPORTED)
- `"manual"` - Manually created notes (IMPORTED)

**Proposed standard:**

- `"conversation"` - Raw conversation pairs
- `"summary"` - LLM-generated summaries
- `"note"` - Manually created context/notes
- `"knowledge"` - Character knowledge/facts

## Migration Plan

### Immediate (Done)

- [x] Standardize timestamps to Unix milliseconds
- [x] Document format differences

### Short-term (Next sprint)

- [ ] Write cleanup script to remove redundant fields from IMPORTED memories
- [ ] Normalize empty strings to null for `channelId`/`guildId`
- [ ] Add `userId` field to all memories for proper scoping

### Long-term (Future)

- [ ] Decide on content format strategy
- [ ] Implement optional summary generation for long conversations
- [ ] Add memory versioning/schema field
- [ ] Consider adding `contextType` field (dm, channel, thread)

## Testing Checklist

Before deploying format changes:

- [ ] Test memory retrieval with mixed formats
- [ ] Verify deduplication works with both formats
- [ ] Ensure timestamp filtering works correctly
- [ ] Test semantic search quality with both content formats
- [ ] Backup Qdrant collection before migration

## Related Files

- Implementation: `services/ai-worker/src/services/ConversationalRAGService.ts:303`
- Ingestion: `scripts/ingest-shapes-inc.cjs:272`
- Migration: `scripts/migrate-qdrant-timestamps.cjs`
- Comparison: `scripts/compare-memory-formats.cjs`
