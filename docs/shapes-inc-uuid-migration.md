# Shapes.inc UUID Migration Guide

## Problem

When importing personalities from shapes.inc exports, the memory data contains old user UUIDs that don't match current Postgres user IDs. This creates "orphaned" memories that can't be migrated to persona-scoped collections.

## Current Status

**Lilith Personality**:
- Total memories: 4463 points
- Current users (in Postgres): 5
- Orphaned UUIDs (from shapes.inc): 89

## UUID Mapping System

### How It Works

The migration script (`scripts/migrate-qdrant-to-personas.cjs`) supports UUID mappings via `scripts/uuid-mappings.json`:

1. Load UUID mappings from JSON file
2. When processing Qdrant points, check if `userId` has a mapping
3. If mapped, replace old UUID with new UUID before grouping
4. All memories (old + new UUIDs) get consolidated under the current user's persona

### Current Mappings

```json
{
  "82ea754e-c3fb-467a-8662-8bc30791b4fe": {
    "newUserId": "80bf4fc1-a240-53d3-bae7-43d6ed3e5bae",
    "username": "fennarin",
    "note": "Snail → Fennarin (name change)",
    "oldMemories": 46,
    "newMemories": 18
  }
}
```

**Result**: Fennarin will get 46 + 18 = 64 total memories migrated to their persona.

## Workflow for Finding Mappings

### 1. Search for User-Specific Keywords

```bash
node scripts/find-user-memories.cjs "username"
```

This shows which UUID has the most memories mentioning that username.

**Example**:
```bash
$ node scripts/find-user-memories.cjs "fennarin"
User ID: 80bf4fc1-a240-53d3-bae7-43d6ed3e5bae (current)
  Memories: 18

$ node scripts/find-user-memories.cjs "snail"
User ID: 82ea754e-c3fb-467a-8662-8bc30791b4fe (old shapes.inc)
  Memories: 46
```

### 2. Add Mapping to uuid-mappings.json

```json
{
  "mappings": {
    "OLD-UUID-FROM-SHAPES": {
      "newUserId": "CURRENT-UUID-FROM-POSTGRES",
      "username": "current-username",
      "note": "context about this mapping",
      "oldMemories": 46,
      "newMemories": 18
    }
  }
}
```

### 3. Run Migration

The script will automatically:
- Load mappings
- Apply them during point processing
- Consolidate all memories under current user

## For 65 Additional Personalities

When importing the other 65 personalities from shapes.inc:

1. **Import personality data to Postgres** (personalities, system_prompts, llm_configs, etc.)
2. **Import Qdrant memories** (will have old shapes.inc UUIDs)
3. **Analyze orphaned UUIDs**:
   ```bash
   node scripts/analyze-qdrant-users.cjs
   ```
4. **For each known user**:
   - Search for their name/keywords in memories
   - Identify their old UUID
   - Add mapping to `uuid-mappings.json`
5. **Run migration**: All mapped users get consolidated memories

## Unknown Users

For the 89 currently orphaned UUIDs we don't recognize:

**Option 1 (Recommended)**: Leave in legacy `personality-{id}` collections
- Safe - no data loss
- When those users create accounts (new Discord interactions), they'll get new deterministic UUIDs
- We can migrate their historical memories later if we discover the mapping

**Option 2**: Try to correlate with Discord usernames/IDs
- Check if shapes.inc exports include Discord metadata
- Match usernames to current Discord server members
- Create mappings for identified users

**Option 3**: Create a `persona-legacy` collection
- Dump all orphaned memories there for manual review
- Not recommended - loses userId association

## Notes

- **Deterministic UUIDs**: New users get UUIDs based on Discord ID (`generateUserUuid(discordId)`)
- **No Discord metadata in shapes.inc**: We don't have Discord IDs for old exports, so we can't regenerate their UUIDs
- **Manual mapping required**: Each old UUID must be manually identified and mapped
- **Consolidation is safe**: Migration creates new collections, original `personality-{id}` collections remain as backup

## Tools

- `scripts/analyze-qdrant-users.cjs` - Lists all Qdrant userIds vs Postgres users
- `scripts/find-user-memories.cjs <keyword>` - Search memories by content
- `scripts/uuid-mappings.json` - UUID mapping configuration
- `scripts/migrate-qdrant-to-personas.cjs` - Migration script (reads mappings)

## Example Workflow

```bash
# 1. Find Fennarin's old memories
node scripts/find-user-memories.cjs "snail"
# Found: 82ea754e-c3fb-467a-8662-8bc30791b4fe (46 memories)

# 2. Check current Postgres UUID
psql -c "SELECT id, username FROM users WHERE username = 'fennarin';"
# Found: 80bf4fc1-a240-53d3-bae7-43d6ed3e5bae

# 3. Add to uuid-mappings.json
{
  "82ea754e-c3fb-467a-8662-8bc30791b4fe": {
    "newUserId": "80bf4fc1-a240-53d3-bae7-43d6ed3e5bae",
    "username": "fennarin",
    "note": "Snail → Fennarin (name change)"
  }
}

# 4. Run migration
node scripts/migrate-qdrant-to-personas.cjs
# ✓ Mapped 46 points from old UUIDs to current users
# ✓ Fennarin gets 64 total memories (46 old + 18 new)
```
