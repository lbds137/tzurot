# Legacy shapes.inc Memory Schema Design

**Goal:** Import ALL shapes.inc memories while supporting incremental migration to current persona system.

---

## Problem Statement

shapes.inc had 9,364 memories from many users, but current tzurot v3 only has 14 users. We need to:

1. **Preserve all legacy data** - don't lose memories from unmapped users
2. **Map what we can** - link memories to current personas where possible
3. **Enable future migration** - allow users to claim their legacy data later
4. **Maintain referential integrity** - ensure database consistency

---

## Proposed Schema Changes

### 1. Add `shapes_persona_mappings` Table

Maps legacy shapes.inc user UUIDs to current tzurot persona UUIDs:

```prisma
model ShapesPersonaMapping {
  id                  String   @id @default(uuid()) @db.Uuid
  shapesUserId        String   @unique @map("shapes_user_id") @db.Uuid  // Legacy shapes.inc user UUID
  personaId           String   @map("persona_id") @db.Uuid               // Current tzurot persona UUID
  persona             Persona  @relation(fields: [personaId], references: [id], onDelete: Cascade)

  // Migration metadata
  mappedAt            DateTime @default(now()) @map("mapped_at")
  mappedBy            String?  @map("mapped_by") @db.Uuid                // User who created mapping (self-service)
  verificationStatus  String   @default("unverified") @map("verification_status") // unverified, verified, admin_verified

  @@map("shapes_persona_mappings")
}
```

### 2. Update `memories` Table

Add support for legacy memories:

```prisma
model Memory {
  // ... existing fields ...

  // CHANGE: Make persona_id nullable to support unmapped legacy memories
  personaId           String?   @map("persona_id") @db.Uuid
  persona             Persona?  @relation(fields: [personaId], references: [id], onDelete: Cascade)

  // ADD: Legacy shapes.inc user UUID (always populated for legacy memories)
  legacyShapesUserId  String?   @map("legacy_shapes_user_id") @db.Uuid

  // ADD: Source tracking
  sourceSystem        String    @default("tzurot-v3") @map("source_system") // "tzurot-v3" or "shapes-inc"

  // ... rest of existing fields ...

  @@index([legacyShapesUserId])  // For querying unmapped legacy memories
  @@index([sourceSystem])
}
```

---

## Migration Strategy

### Phase 1: Initial Bulk Import (Now)

**For each shapes.inc memory:**

1. **Check if mapping exists** in `shapes_persona_mappings`
   - If YES: use mapped `persona_id`
   - If NO: leave `persona_id` NULL

2. **Always populate:**
   - `legacy_shapes_user_id` = shapes.inc user UUID
   - `source_system` = "shapes-inc"
   - `personality_id` = lookup by slug (already working)
   - `content` = memory text
   - `embedding` = generate with OpenAI

3. **Insert with deterministic UUID:**
   - Key: `${legacyShapesUserId}:${personalityId}:${contentHash}`
   - Enables idempotent re-runs

**Result:** ALL 9,364 memories imported, ~14 mapped to current personas

### Phase 2: User Self-Service Migration (Future)

**New slash command:** `/claim-legacy-data`

```
User runs: /claim-legacy-data shapes-user-id:<UUID>

Bot:
1. Checks if shapes-user-id has any memories
2. Shows summary: "Found 245 memories across 12 personalities"
3. Asks for confirmation
4. Creates mapping in shapes_persona_mappings
5. Updates all memories: SET persona_id = <current> WHERE legacy_shapes_user_id = <old>
6. Responds: "Claimed 245 legacy memories! They're now part of your persona."
```

### Phase 3: Admin Bulk Migration (Future)

**Admin slash command:** `/admin migrate-legacy-user`

For importing known users manually:

```
/admin migrate-legacy-user shapes-id:<UUID> discord-user:<@mention>

Creates verified mapping + updates all memories
```

---

## Query Patterns

### Current Persona Memories (for RAG)
```sql
-- Get memories for current conversations
SELECT * FROM memories
WHERE persona_id = $1  -- Current persona UUID
  AND personality_id = $2
ORDER BY embedding <=> $3::vector
LIMIT 10;
```

### Legacy Unmapped Memories (for admin review)
```sql
-- Find all unmapped legacy memories
SELECT
  legacy_shapes_user_id,
  personality_name,
  COUNT(*) as memory_count
FROM memories
WHERE source_system = 'shapes-inc'
  AND persona_id IS NULL
GROUP BY legacy_shapes_user_id, personality_name
ORDER BY memory_count DESC;
```

### User's Total Memories (mapped + legacy)
```sql
-- All memories for a persona (including claimed legacy)
SELECT * FROM memories
WHERE persona_id = $1
   OR legacy_shapes_user_id IN (
     SELECT shapes_user_id
     FROM shapes_persona_mappings
     WHERE persona_id = $1
   )
ORDER BY created_at DESC;
```

---

## Database Integrity

### Foreign Key Strategy

**persona_id:**
- Nullable for unmapped legacy memories
- Has FK constraint when populated
- CASCADE delete: if persona deleted, memories are deleted too

**legacy_shapes_user_id:**
- No FK constraint (shapes.inc users don't exist in our DB)
- Just a string UUID for tracking
- Never NULL for legacy memories

### Data Consistency Rules

1. **All shapes-inc memories:** `source_system = "shapes-inc"` AND `legacy_shapes_user_id IS NOT NULL`
2. **All v3 memories:** `source_system = "tzurot-v3"` AND `persona_id IS NOT NULL`
3. **Mapped legacy memories:** Both `persona_id` AND `legacy_shapes_user_id` populated
4. **Unmapped legacy memories:** Only `legacy_shapes_user_id` populated

---

## Migration SQL

### Create shapes_persona_mappings table
```sql
CREATE TABLE shapes_persona_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shapes_user_id UUID NOT NULL UNIQUE,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mapped_by UUID,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'unverified'
);

CREATE INDEX idx_shapes_persona_mappings_persona ON shapes_persona_mappings(persona_id);
```

### Alter memories table
```sql
-- Make persona_id nullable
ALTER TABLE memories ALTER COLUMN persona_id DROP NOT NULL;

-- Add legacy tracking columns
ALTER TABLE memories ADD COLUMN legacy_shapes_user_id UUID;
ALTER TABLE memories ADD COLUMN source_system VARCHAR(50) NOT NULL DEFAULT 'tzurot-v3';

-- Add indexes
CREATE INDEX idx_memories_legacy_shapes_user ON memories(legacy_shapes_user_id);
CREATE INDEX idx_memories_source_system ON memories(source_system);

-- Backfill existing memories as tzurot-v3 source
UPDATE memories SET source_system = 'tzurot-v3' WHERE source_system = 'tzurot-v3';
```

---

## Benefits

1. **No data loss** - All 9,364 shapes.inc memories preserved
2. **Incremental migration** - Users can claim data over time
3. **Flexible** - Admin can assist with migrations
4. **Clean queries** - Can query by current persona OR legacy ID
5. **Referential integrity** - Proper FK constraints where applicable
6. **Future-proof** - Easy to add more mappings later

---

## Implementation Order

1. ✅ Create migration SQL for schema changes
2. ✅ Apply to dev database
3. ✅ Update Prisma schema
4. ✅ Generate Prisma client
5. ✅ Update shapes-inc import script to use new schema
6. ✅ Re-run import (should import all 9,364 memories)
7. [ ] Implement PgvectorMemoryAdapter (handles nullable persona_id)
8. [ ] Deploy to Railway
9. [ ] (Future) Implement `/claim-legacy-data` command
10. [ ] (Future) Implement admin migration tools

---

## Rollback Safety

If we need to revert:

1. Existing memories unaffected (persona_id still populated)
2. Drop new columns: `legacy_shapes_user_id`, `source_system`
3. Make `persona_id` NOT NULL again
4. Drop `shapes_persona_mappings` table
5. Legacy import can be re-run later with updated script

---

## Example Data Flow

**User "Lila" (Discord: 278863839632818186):**

Current state:
- Has tzurot v3 user account
- Has default persona UUID: `57240faf-...`
- Used shapes.inc with user UUID: `98a94b95-...`

After migration:
1. **Import:** 1,234 memories with `legacy_shapes_user_id = 98a94b95-...`, `persona_id = NULL`
2. **User runs:** `/claim-legacy-data 98a94b95-cbd0-430b-8be2-602e1c75d8b0`
3. **Mapping created:** `98a94b95-...` → `57240faf-...`
4. **Memories updated:** All 1,234 memories now have `persona_id = 57240faf-...`
5. **RAG queries:** Now include legacy memories automatically!

---

This design preserves all legacy data while enabling incremental, user-driven migration. 🎯
