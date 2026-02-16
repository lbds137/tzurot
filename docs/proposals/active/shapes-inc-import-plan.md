# Shapes.inc Character Backup & Import

> **Status**: Active — Awaiting real API data inspection before implementation
> **Created**: 2026-02-16
> **Supersedes**: `docs/proposals/backlog/SHAPES_INC_SLASH_COMMAND_DESIGN.md` (detailed reference)
> **Related**: `scripts/data/import-personality/` (existing CLI tooling), `scripts/data/backup-personalities-data.js` (v3 backup script)

## Context

A shapes.inc user wants to export their character data and migrate to Tzurot. The shapes.inc platform continues to deteriorate, making this urgent. We're pulling the "Character Portability" theme from the backlog Future Themes and building the full automated flow.

**Two modes:**

1. **Export**: Fetch data from shapes.inc, provide as downloadable JSON
2. **Import**: Fetch + import directly into Tzurot (personality, system prompt, LLM config, memories)

**Sidecar prompt dependency**: Shapes.inc has `user_personalization` data (per-user instructions to characters). We don't know the exact format yet. We'll build the data fetcher first, inspect the real data, then decide where to store it in Tzurot.

**Blocking on**: Real shapes.inc API data (will be placed in `debug/shapes/` for inspection). Some undocumented API endpoints may have changed since late 2025.

---

## Command Structure: `/shapes`

New top-level command group (cleaner than overloading `/character import`):

| Subcommand              | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `/shapes auth`          | Opens modal for session cookie input (masked, ephemeral) |
| `/shapes logout`        | Remove stored credentials                                |
| `/shapes import <slug>` | Fetch from shapes.inc + import into Tzurot               |
| `/shapes export <slug>` | Fetch from shapes.inc + provide as downloadable ZIP/JSON |
| `/shapes status`        | Credential status + import history                       |

---

## Phase 1: Schema + Credential Management

### Database Migration

Two new tables, one migration:

**UserCredential** — Reuses the `encryptApiKey`/`decryptApiKey` pattern from `packages/common-types/src/utils/encryption.ts` (AES-256-GCM, same `API_KEY_ENCRYPTION_KEY` env var):

```prisma
model UserCredential {
  id             String    @id @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  service        String    @db.VarChar(50)       // 'shapes_inc'
  credentialType String    @map("credential_type") @db.VarChar(50) // 'session_cookie'
  iv             String    @db.VarChar(32)
  content        String    @db.Text
  tag            String    @db.VarChar(32)
  createdAt      DateTime  @default(now()) @map("created_at")
  expiresAt      DateTime? @map("expires_at")
  lastUsedAt     DateTime? @map("last_used_at")
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, service, credentialType])
  @@index([userId])
  @@map("user_credentials")
}
```

**ImportJob** — Tracks import history and audit:

```prisma
model ImportJob {
  id               String    @id @db.Uuid
  userId           String    @map("user_id") @db.Uuid
  personalityId    String?   @map("personality_id") @db.Uuid
  sourceSlug       String    @map("source_slug") @db.VarChar(255)
  sourceService    String    @map("source_service") @db.VarChar(50)
  status           String    @default("pending") @db.VarChar(50)
  memoriesImported Int?      @map("memories_imported")
  memoriesFailed   Int?      @map("memories_failed")
  createdAt        DateTime  @default(now()) @map("created_at")
  startedAt        DateTime? @map("started_at")
  completedAt      DateTime? @map("completed_at")
  errorMessage     String?   @map("error_message")
  importMetadata   Json?     @map("import_metadata")
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  personality      Personality? @relation(fields: [personalityId], references: [id], onDelete: SetNull)
  @@unique([userId, sourceSlug, sourceService])
  @@index([userId])
  @@index([status])
  @@map("import_jobs")
}
```

### Auth Commands (bot-client + api-gateway)

**`/shapes auth`**: Opens modal -> POST encrypted cookie to gateway -> stored in `user_credentials`

- Follow pattern from: `services/bot-client/src/commands/settings/apikey/` + `services/api-gateway/src/routes/wallet/setKey.ts`

**`/shapes logout`**: DELETE credential -> confirm ephemerally

**Gateway routes**: `POST/DELETE/GET /user/shapes/auth`

### Files to create/modify

| File                                                   | Action                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `prisma/schema.prisma`                                 | Add UserCredential, ImportJob models + User/Personality relations |
| Migration SQL                                          | `pnpm ops db:safe-migrate --name add_shapes_import_tables`        |
| `packages/common-types/src/utils/deterministicUuid.ts` | Add `generateUserCredentialUuid`, `generateImportJobUuid`         |
| `packages/common-types/src/constants/queue.ts`         | Add `ShapesImport` job type + prefix                              |
| `packages/common-types/src/types/shapes-import.ts`     | Job data/result types                                             |
| `services/bot-client/src/commands/shapes/index.ts`     | Command definition                                                |
| `services/bot-client/src/commands/shapes/auth.ts`      | Modal handler                                                     |
| `services/bot-client/src/commands/shapes/logout.ts`    | Logout handler                                                    |
| `services/api-gateway/src/routes/user/shapes/auth.ts`  | Credential CRUD                                                   |
| `services/api-gateway/src/routes/user/index.ts`        | Mount shapes routes                                               |

---

## Phase 2: Data Fetcher Service

Port `scripts/data/backup-personalities-data.js` to TypeScript service in ai-worker.

**Location**: `services/ai-worker/src/services/shapes/ShapesDataFetcher.ts`

Why ai-worker (not api-gateway): The fetcher is an internal data source for a background job, not an HTTP route served to bot-client. ai-worker already makes external HTTP calls during job processing (ModelFactory -> OpenRouter/Gemini APIs). The shapes.inc fetcher follows the same pattern. Putting it in api-gateway would require passing large JSON payloads through BullMQ (anti-pattern -- jobs should be lightweight references, not megabytes of data).

**Key adaptations from the standalone script:**

- TypeScript with proper types (move shapes.inc types from `scripts/data/import-personality/types.ts` to `common-types`)
- Return structured data objects instead of writing JSON files to disk
- Use native `fetch()` (Node 25) instead of `https.get()`
- AbortController timeouts per request
- Structured error types: `ShapesAuthError`, `ShapesNotFoundError`, `ShapesRateLimitError`
- Progress callback for DM updates (future)
- 1s delay between requests (respectful rate limiting, matching existing script)

```typescript
interface ShapesDataFetchResult {
  config: ShapesIncPersonalityConfig;
  memories: ShapesIncMemory[];
  knowledge: unknown[]; // Raw, format varies
  userPersonalization: unknown | null; // Unknown format -- inspect and decide later
  chatHistory: ShapesIncChatMessage[];
  stats: { memoriesCount; chatMessagesCount; knowledgeCount };
}
```

### Files to create

| File                                                               | Action                                           |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `services/ai-worker/src/services/shapes/ShapesDataFetcher.ts`      | Data fetching service                            |
| `services/ai-worker/src/services/shapes/ShapesDataFetcher.test.ts` | Tests with mocked HTTP                           |
| `packages/common-types/src/types/shapes-import.ts`                 | Shapes.inc type definitions (moved from scripts) |

---

## Phase 3: Import Pipeline

BullMQ job processor that orchestrates the full import. Adapts logic from `scripts/data/import-personality/PersonalityMapper.ts` and `MemoryImporter.ts`.

**Critical difference from existing scripts**: Memories now live in **pgvector (PostgreSQL)**, not Qdrant. Embeddings are generated **locally** via `LocalEmbeddingService` (BGE-small-en-v1.5, 384 dimensions) -- **no API costs**.

### Job Flow

```
ShapesImportJob.process(job):
  1. Update ImportJob status -> 'in_progress'
  2. Decrypt session cookie from UserCredential (using decryptApiKey)
  3. Fetch all data via ShapesDataFetcher
  4. Validate data with PersonalityMapper
  5. Create Personality + SystemPrompt + LlmConfig + PersonalityDefaultConfig in Prisma transaction
  6. Download avatar -> store in personality.avatarData (binary)
  7. For each memory batch:
     - Generate embedding via LocalEmbeddingService
     - INSERT into memories table (pgvector)
  8. Update ImportJob -> 'completed' with stats
  9. Publish completion event to Redis stream -> bot-client sends DM
```

### Personality Mapping (adapted from existing PersonalityMapper)

Reuses the field mapping logic from `scripts/data/import-personality/PersonalityMapper.ts`:

- `jailbreak` -> SystemPrompt content
- `user_prompt` -> characterInfo
- `personality_*` fields -> direct mapping
- `engine_*` fields -> LlmConfig advancedParameters JSONB
- `stm_window/ltm_*` -> context/memory config
- Custom fields (keywords, favorite_reacts, etc.) -> personality.customFields JSONB
- `user_personalization` -> stored raw in customFields for now (Phase 5 decides proper storage)

### Memory Import (new -- targets pgvector, not Qdrant)

Use `PgvectorMemoryAdapter.addMemory()` for correctness (one at a time initially). Pattern from `services/ai-worker/src/services/PgvectorMemoryAdapter.ts`.

For each shapes.inc memory:

1. Generate embedding via `LocalEmbeddingService.generateEmbedding(memory.result)`
2. Build metadata matching v3 schema (`V3MemoryMetadata`)
3. Insert via pgvector adapter

**Optimization (if needed later)**: Batch embeddings + raw `$executeRaw` multi-row INSERT.

### Job Routing

Add `shapes-import` case to `AIJobProcessor.processJob()` at `services/ai-worker/src/jobs/AIJobProcessor.ts:108-117`. The import job handler gets its own class with separate dependency injection.

### Files to create/modify

| File                                                                | Action                         |
| ------------------------------------------------------------------- | ------------------------------ |
| `services/ai-worker/src/services/shapes/ShapesPersonalityMapper.ts` | Adapted from scripts version   |
| `services/ai-worker/src/services/shapes/ShapesMemoryImporter.ts`    | New pgvector-targeted importer |
| `services/ai-worker/src/jobs/ShapesImportJob.ts`                    | BullMQ job processor           |
| `services/ai-worker/src/jobs/ShapesImportJob.test.ts`               | Tests                          |
| `services/ai-worker/src/jobs/AIJobProcessor.ts`                     | Add routing for shapes-import  |
| `services/api-gateway/src/routes/user/shapes/import.ts`             | Create ImportJob + enqueue     |

---

## Phase 4: Slash Commands (User-Facing)

### `/shapes import <slug>`

1. Defer reply (ephemeral)
2. Check credentials exist (GET `/user/shapes/auth/status`)
3. If none: show auth instructions with link to `/shapes auth`
4. Check for existing import (GET `/user/shapes/import-jobs?slug=<slug>`)
5. Show confirmation embed with [Confirm Import] [Cancel] buttons
6. On confirm: POST `/user/shapes/import` -> creates ImportJob + queues BullMQ job
7. Reply: "Import started! I'll DM you when it's complete."

### `/shapes export <slug>`

1. Defer reply (ephemeral)
2. Check credentials
3. POST `/user/shapes/export` -> fetches data from shapes.inc
4. Return as Discord attachment (JSON file with personality config, memories, etc.)
5. For large exports (>8MB Discord limit): return personality config + stats summary, instruct user to use CLI script for full backup

### `/shapes status`

1. Show credential status (exists? when stored?)
2. List import history with status, character name, memory count

### Files to create

| File                                                        | Action                                |
| ----------------------------------------------------------- | ------------------------------------- |
| `services/bot-client/src/commands/shapes/import.ts`         | Import command + confirmation buttons |
| `services/bot-client/src/commands/shapes/export.ts`         | Export command                        |
| `services/bot-client/src/commands/shapes/status.ts`         | Status/history command                |
| `services/api-gateway/src/routes/user/shapes/import.ts`     | Import job creation                   |
| `services/api-gateway/src/routes/user/shapes/export.ts`     | Export data endpoint                  |
| `services/api-gateway/src/routes/user/shapes/importJobs.ts` | Import history                        |

---

## Phase 5: Sidecar Prompts (After Data Inspection)

**Deferred until we can inspect actual `user_personalization` data from Phase 2.**

Once we see the real data format, decide:

- **Option A**: Map to `Persona.content` (already injected into prompts as participant context)
- **Option B**: Add `sidecarPrompt` field to `UserPersonalityConfig` (new prompt assembly logic needed)
- **Option C**: Add `systemPrompt` to User model (global per-user, not per-character)

Until then, raw `user_personalization` data is preserved in `personality.customFields` JSONB -- no data loss, just not actively used in prompting yet.

---

## What's Deferred (Not in MVP)

| Item                              | Why Deferred                                              |
| --------------------------------- | --------------------------------------------------------- |
| DM progress updates (incremental) | Completion-only DM is sufficient for MVP                  |
| Knowledge/training data import    | No Tzurot equivalent yet                                  |
| Chat history import               | No Tzurot feature to map this to                          |
| Force re-import / overwrite       | Handle by preventing duplicates initially                 |
| Batch import UI                   | Single character import is sufficient                     |
| Import rate limiting              | Single-user project, not needed                           |
| BYOK for embeddings               | Embeddings are local (free) -- this concern is eliminated |

---

## Delivery

Single feature branch, one PR for Phase 1-4. Commits per phase for reviewability.

---

## Dependency Graph

```
Phase 1 (Schema + Auth) ------------------> Phase 4 (Slash Commands)
    |                                            |
    +---> Phase 2 (Fetcher) ---> Phase 3 (Import Pipeline) ---> Phase 5 (Sidecar)
```

- Phase 1 and 2 are partially parallelizable (schema must come first, then auth + fetcher can overlap)
- Phase 3 depends on both 1 (credential decryption) and 2 (data fetching)
- Phase 4 depends on 1 (auth commands) and 3 (import queuing)
- Phase 5 depends on Phase 2 output (real data inspection)

---

## Verification Plan

After each phase:

1. **Phase 1**: `pnpm ops db:migrate` succeeds, `/shapes auth` stores encrypted cookie, `/shapes logout` deletes it, `pnpm quality` passes
2. **Phase 2**: Unit tests with mocked HTTP responses, test against real shapes.inc data (manual, with user's cookie)
3. **Phase 3**: Integration test with test data, verify personality + memories created in DB, `pnpm test` + `pnpm test:int` pass
4. **Phase 4**: End-to-end: auth -> import -> verify character exists -> talk to it
5. **Phase 5**: Inspect real user_personalization data, design storage, implement

Run `pnpm quality` after every phase. Run `pnpm test:int` after Phase 4 (new slash commands = snapshot changes).

---

## Existing Reference Documents

- **Detailed design doc**: `docs/proposals/backlog/SHAPES_INC_SLASH_COMMAND_DESIGN.md` (1174 lines, comprehensive UX/technical spec)
- **API reference**: `tzurot-legacy/docs/external-services/SHAPES_INC_API_REFERENCE.md`
- **Import scripts**: `scripts/data/import-personality/` (PersonalityMapper, MemoryImporter, types)
- **Backup script**: `scripts/data/backup-personalities-data.js`
- **Type definitions**: `scripts/data/import-personality/types.ts`
