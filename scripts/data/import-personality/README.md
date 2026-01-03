# Shapes.inc Personality Import Tool

This directory contains the tooling for importing personalities from shapes.inc backups to Tzurot v3.

## ✅ Completed Components

### 1. Type Definitions (`types.ts`)

- **Shapes.inc format types**: Maps the 385-line shapes.inc JSON structure
- **V3 format types**: Target schema for PostgreSQL and Qdrant
- **Import tool types**: Options, results, validation types
- **Custom fields preserved**: `favorite_reacts`, `keywords`, `search_description`, custom messages

### 2. PersonalityMapper (`PersonalityMapper.ts`)

Maps shapes.inc personality config to v3 normalized schema:

- **Personality table**: Core fields, traits, goals, examples
- **System prompt table**: Extracted from `jailbreak` field
- **LLM config table**: Model, temperature, penalties, memory settings
- **Custom fields**: Preserves extra data in JSON column (keywords, favorite emojis, etc.)
- **Model names**: Pass-through (shapes.inc used OpenRouter same as v3)
- **Validation**: Checks required fields, ranges, formats
- **✅ Tested**: Successfully maps cold-kerach-batuach config

### 3. AvatarDownloader (`AvatarDownloader.ts`)

Downloads and stores personality avatars:

- **Download**: Fetches from shapes.inc URLs
- **Storage**: Saves to Railway volume (`/data/avatars`)
- **Fallback**: Uses default avatar if download fails
- **Management**: Check existence, delete, list all avatars
- **Public URLs**: Generates URLs for API gateway serving

### 4. UUIDMapper (`UUIDMapper.ts`)

Resolves UUID mappings between shapes.inc and v3:

- **User resolution**: Shapes.inc UUID → Discord ID → V3 Persona UUID
- **Orphan handling**: Assigns orphaned persona when user can't be resolved
- **Caching**: Avoids repeated database queries
- **Batch operations**: Resolve multiple users efficiently
- **Statistics**: Track resolution success rate

### 5. MemoryImporter (`MemoryImporter.ts`)

Imports LTM memories to Qdrant:

- **Format mapping**: Shapes.inc memory → V3 Qdrant metadata
- **User resolution**: Uses UUIDMapper for persona assignment
- **Orphan tracking**: Counts and handles orphaned memories
- **Validation**: Checks for duplicate IDs, empty summaries, invalid timestamps
- **Statistics**: Import counts, errors, warnings
- **Dry run mode**: Parse and validate without writing

## 🚧 Remaining Work

### 6. Main CLI Tool (`import-personality.ts`)

Orchestrates the import process:

- [ ] Parse command-line arguments
- [ ] Load shapes.inc backup files
- [ ] Initialize Prisma, Qdrant clients
- [ ] Execute personality import
- [ ] Execute memory import
- [ ] Handle errors and rollback
- [ ] Display progress and results

### 7. Qdrant Cleanup Tool (`QdrantMigrator.ts`)

Standardize existing Qdrant memories:

- [ ] Find memories with old personality collection format
- [ ] Find orphaned entries (Lilith and others)
- [ ] Update metadata to standardized v3 format
- [ ] Handle persona assignment for orphaned memories
- [ ] Dry run mode for validation
- [ ] Backup before migration

**Use case**: Lilith has orphaned entries in old format that need standardization.

### 8. Integration Points

#### Database Operations

- [ ] Create personality in PostgreSQL
- [ ] Create system prompt record
- [ ] Create LLM config record
- [ ] Create personality-llm-config link
- [ ] Create/ensure orphaned persona

#### Qdrant Operations

- [ ] Generate embeddings (OpenAI API)
- [ ] Store memories with vectors and metadata
- [ ] Handle Qdrant errors and retries

#### Avatar Operations

- [ ] Download avatar from shapes.inc
- [ ] Save to Railway volume
- [ ] Update personality avatar URL
- [ ] Add static serving to API gateway

## 📊 Test Data

Using **cold-kerach-batuach** as test personality:

- **Config**: 30KB JSON, 385 lines
- **Memories**: 107 LTM summaries (~1.2MB)
- **Chat history**: 625 messages (~500KB)
- **Date range**: 2025-05-18 to 2025-07-22
- **Unique users**: 1

## 🔧 Usage (Planned)

```bash
# Full import (personality + memories)
pnpm import-personality cold-kerach-batuach

# Dry run (validate without writing)
pnpm import-personality cold-kerach-batuach --dry-run

# Memories only (skip personality creation)
pnpm import-personality cold-kerach-batuach --memories-only

# Force overwrite existing
pnpm import-personality cold-kerach-batuach --force

# Rename to avoid conflict
pnpm import-personality cold-kerach-batuach --rename=cold-v2
```

## 📝 Notes

### Custom Fields Preserved

All shapes.inc-specific fields are preserved in the `customFields` JSON column:

- `favoriteReacts`: Emoji reactions (e.g., ["🧊", "📊", "🔍"])
- `keywords`: Search keywords (e.g., ["COLD", "efficiency", "data"])
- `searchDescription`: Brief personality description
- `errorMessage`, `wackMessage`, `sleepMessage`: Custom messages
- `shapesIncId`: Original shapes.inc UUID for reference

### Model Names

Shapes.inc used OpenRouter (same as v3), so model names are passed through as-is:

- `openai/gpt-oss-120b` → `openai/gpt-oss-120b` (preserved)
- `anthropic/claude-3.5-sonnet` → `anthropic/claude-3.5-sonnet` (preserved)
- No mapping needed!

### Avatar Handling

- Shapes.inc avatars are at `https://files.shapes.inc/api/files/avatar_{uuid}.png`
- No avatars in legacy backups (must download fresh)
- Download during import, store in `/data/avatars`
- Serve via API gateway at `/avatars/{slug}.ext`

### Orphaned Memories

When user UUID can't be resolved:

- Assign to dedicated orphaned persona (`00000000-0000-0000-0000-000000000000`)
- Mark as `canonScope: 'shared'` (not personal)
- Track orphan count in import stats
- Later migration possible if user links account

## 🧪 Testing

```bash
# Test PersonalityMapper
npx tsx scripts/import-personality/test-mapper.ts

# Test custom fields extraction
npx tsx scripts/import-personality/test-custom-fields.ts
```

## 📚 References

- **Import plan**: `/docs/migration/SHAPES_INC_IMPORT_PLAN.md`
- **V3 schema**: `/prisma/schema.prisma`
- **Qdrant metadata**: `/services/ai-worker/src/memory/QdrantMemoryAdapter.ts`
- **Personality service**: `/packages/common-types/src/services/personality/`
- **Test data**: `/tzurot-legacy/data/personalities/cold-kerach-batuach/`
