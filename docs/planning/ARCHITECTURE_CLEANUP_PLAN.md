# Architecture Cleanup & Refactoring Plan

**Created**: 2025-11-17
**Branch**: `refactor/architecture-cleanup-2025-11-17`
**Goal**: Improve code maintainability through DRY principles, better organization, and comprehensive test coverage

---

## Overview

This plan addresses technical debt and architectural improvements identified through comprehensive codebase analysis. Focus areas:
- Breaking large files into smaller, focused modules
- Eliminating code duplication (DRY)
- Converting stateful utils to proper classes
- Adding test coverage for critical paths
- Fixing architectural inconsistencies

**Total Impact**:
- ~600 lines of duplication eliminated
- 4 files >500 lines split to <300 each
- 8 critical paths get test coverage
- 3 architectural issues fixed

---

## Phase 1: Quick Wins (High Impact, Low Risk)

### ✅ COMPLETED
- Created feature branch
- Documented plan
- **Task 1.1**: Dependency Injection Architecture ✅
  - Phase 1 (api-gateway): Routes refactored to factory pattern with DI
  - Phase 2 (ai-worker): Processors refactored for DI
  - Phase 3 (bot-client): All services refactored for DI
  - All 762 tests passing
  - Commits: 3 (one per phase)
- **Task 1.2**: Extract Owner-Only Check Middleware ✅
  - Created `requireBotOwner()` middleware in common-types
  - Updated admin.ts and personality.ts to use middleware
  - Eliminated ~30 lines of security code duplication
  - 6 comprehensive tests added
  - All 768 tests passing
- **Task 1.3**: Extract Avatar Processing Utility ✅
  - Created `processAvatarAttachment()` utility in bot-client/utils
  - Updated personality.ts create and edit subcommands
  - Eliminated ~70 lines of duplication
  - 14 comprehensive tests added (validation, download, edge cases)
  - Custom error type for better error handling
  - All 782 tests passing
- **Task 3.1**: Split Command Files into Modular Subcommand Handlers ✅
  - Split personality command (817 lines → 697 lines across 6 files)
    - personality/index.ts: Command registration and routing
    - personality/create.ts, edit.ts, import.ts, create-modal.ts, modal.ts: Focused handlers
  - Split admin command (372 lines → 403 lines across 5 files)
    - admin/index.ts: Command registration and routing
    - admin/db-sync.ts, servers.ts, kick.ts, usage.ts: Focused handlers
  - Split utility command (137 lines → 81 lines across 3 files)
    - utility/index.ts: Command registration and routing
    - utility/ping.ts, help.ts: Focused handlers
  - All commands follow consistent modular pattern
  - Pattern enables easier addition of future subcommands
  - All 782 tests passing
  - Commits: 3 (one per command split)

### 🚧 IN PROGRESS
None

### 📋 TODO

#### ~~Task 1.1: Implement Dependency Injection Architecture~~ ✅ COMPLETED
**Priority**: HIGH (prevents connection pool exhaustion, enables testability)
**Effort**: 3-4 hours
**Files affected**: ~15 files across services

**Problem**: Multiple files create `new PrismaClient()` directly, and dependencies are hidden/hard to test

---

#### ~~Task 1.2: Extract Owner-Only Check Middleware~~ ✅ COMPLETED

**Solution**: Implement proper DI architecture (based on Gemini consultation)

**Architecture Pattern**:
1. **Services**: Use constructor injection for dependencies
2. **Routes**: Use factory pattern, inject services (not Prisma directly)
3. **Composition Root**: Single place to wire dependencies (index.ts in each service)

**Implementation Plan**:

**Phase 1: api-gateway**
1. Refactor DatabaseSyncService to accept Prisma via constructor
2. Add unit tests for DatabaseSyncService
3. Refactor routes to factory pattern:
   - `createAdminRouter(prisma, syncService)`
   - `createAIRouter(prisma, jobQueue)`
4. Add tests for route handlers (mock services)
5. Update index.ts composition root

**Phase 2: ai-worker**
1. Refactor AIJobProcessor to accept Prisma via constructor
2. Refactor PendingMemoryProcessor to accept Prisma via constructor
3. Add unit tests for processors
4. Update index.ts composition root

**Phase 3: bot-client**
1. Refactor ConversationPersistence to accept Prisma via constructor
2. Add unit tests
3. Update composition root

**Example Pattern**:
```typescript
// Service with DI
export class DatabaseSyncService {
  constructor(
    private prisma: PrismaClient,
    private devDbUrl: string,
    private prodDbUrl: string
  ) {}
}

// Route factory
export function createAdminRouter(
  prisma: PrismaClient,
  syncService: DatabaseSyncService
): Router {
  const router = express.Router();
  // routes use injected services
  return router;
}

// Composition root (index.ts)
const prisma = getPrismaClient();
const syncService = new DatabaseSyncService(prisma, devUrl, prodUrl);
app.use('/admin', createAdminRouter(prisma, syncService));
```

**Testing Strategy**:
- Services: Mock Prisma client, test business logic in isolation
- Routes: Mock services, test HTTP handling
- Integration: Test composition root wiring

**Benefits**:
- ✅ Fixes connection pool issue
- ✅ Makes all services unit testable
- ✅ Explicit dependencies (constructor shows what's needed)
- ✅ Enables mocking without vi.mock hacks
- ✅ Proper separation of concerns

---

#### Task 1.2: Extract Owner-Only Check Middleware
**Priority**: HIGH (security code should be centralized)
**Effort**: 45 minutes
**Files affected**: 2 command files + 1 new utility

**Problem**: Identical owner verification logic duplicated in `/commands/admin.ts` and `/commands/personality.ts` (lines 72-88 in both)

**Solution**: Create shared middleware
```typescript
// packages/common-types/src/utils/ownerMiddleware.ts
export async function requireBotOwner(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const ownerId = process.env.BOT_OWNER_ID;
  if (!ownerId) {
    await interaction.reply({
      content: '⚠️ Bot owner not configured',
      ephemeral: true,
    });
    return false;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ This command is only available to the bot owner.',
      ephemeral: true,
    });
    return false;
  }

  return true;
}
```

**Files to update**:
- Create `packages/common-types/src/utils/ownerMiddleware.ts`
- Update `services/bot-client/src/commands/admin.ts`
- Update `services/bot-client/src/commands/personality.ts`

**Tests needed**:
- Unit tests for `ownerMiddleware.ts` (3 scenarios: no owner, wrong user, correct user)
- Verify existing command behavior unchanged

**Impact**: Removes ~80 lines of duplication, centralizes security logic

---

#### ~~Task 1.3: Extract Avatar Processing Utility~~ ✅ COMPLETED
**Priority**: HIGH (most significant duplication)
**Effort**: 1 hour
**Files affected**: 1 command file + 1 new utility

**Problem**: Avatar download/validation code duplicated between create (lines 236-273) and edit (lines 408-443) subcommands in `commands/personality.ts`

**Solution**: Create shared utility
```typescript
// services/bot-client/src/utils/avatarProcessor.ts
export async function processAvatarAttachment(
  attachment: Attachment
): Promise<string> {
  // Validate image type
  // Download with size limit
  // Convert to base64
  // Return data URL
}
```

**Files to update**:
- Create `services/bot-client/src/utils/avatarProcessor.ts`
- Update `services/bot-client/src/commands/personality.ts` (2 locations)

**Tests needed**:
- Unit tests for `avatarProcessor.ts`:
  - Invalid file type
  - File too large
  - Successful processing
  - Network error handling

**Impact**: Removes ~80 lines of duplication

---

## Phase 2: Test Coverage (Critical Gaps)

### Task 2.1: Add Route Handler Tests
**Priority**: HIGH (user-facing, no tests)
**Effort**: 3-4 hours
**Files affected**: 2 route files + 2 new test files

**Files needing tests**:
1. `services/api-gateway/src/routes/ai.ts` (391 lines)
   - POST /ai/generate
   - POST /ai/transcribe
   - POST /ai/describe-image
   - GET /ai/job/:jobId

2. `services/api-gateway/src/routes/admin.ts` (385 lines)
   - POST /admin/db-sync
   - GET /admin/db-sync/status
   - POST /admin/db-sync/cancel

**Test strategy**:
- Mock Prisma client
- Mock BullMQ queue
- Test happy paths
- Test error cases
- Test validation

**Estimated tests**: 30-40 test cases total

---

### Task 2.2: Add Command Handler Tests
**Priority**: MEDIUM (user-facing, complex logic)
**Effort**: 4-5 hours
**Files affected**: 2 command files + 2 new test files

**Files needing tests**:
1. `services/bot-client/src/commands/admin.ts` (375 lines)
   - /admin servers
   - /admin leave
   - /admin usage

2. `services/bot-client/src/commands/personality.ts` (866 lines)
   - /personality create
   - /personality edit
   - /personality import
   - /personality list

**Test strategy**:
- Mock Discord interactions
- Mock Prisma client
- Test subcommand routing
- Test validation
- Test error handling

**Note**: Should do this AFTER Task 3.1 (splitting personality.ts)

---

### Task 2.3: Add Service Tests
**Priority**: MEDIUM
**Effort**: 2-3 hours

**Services needing tests**:
- `bot-client/src/services/MessageContextBuilder.ts` (215 lines)
- `api-gateway/src/services/DatabaseSyncService.ts` (551 lines)

**Note**: DatabaseSyncService should be split first (Phase 3)

---

## Phase 3: Large File Splitting

### ~~Task 3.1: Split personality.ts Command~~ ✅ COMPLETED
**Priority**: HIGH (largest file, enables Task 2.2)
**Effort**: 2-3 hours
**Completed**: 2025-11-17

**Outcome**: Successfully split all command files following consistent modular pattern:
- personality.ts (817 lines → 697 lines across 6 files)
- admin.ts (372 lines → 403 lines across 5 files)
- utility.ts (137 lines → 81 lines across 3 files)

Each command follows the pattern:
```
commands/command-name/
├── index.ts              # Main command registration & routing
├── subcommand1.ts        # Focused handler
├── subcommand2.ts        # Focused handler
└── ...
```

**Impact**:
- Consistent pattern across all commands
- Easier to add new subcommands in future
- Each subcommand independently maintainable
- All 782 tests passing

---

### Task 3.2: Split MessageReferenceExtractor
**Priority**: MEDIUM (complex but well-tested)
**Effort**: 3-4 hours
**Current**: 841 lines → **Target**: ~350 lines

**Problem**: Single class doing 5 different things (reply extraction, link parsing, snapshots, voice transcripts, deduplication)

**New structure**:
```
handlers/references/
├── MessageReferenceExtractor.ts  # Main orchestrator (~200 lines)
├── ReplyExtractor.ts             # Reply reference logic (~150 lines)
├── LinkExtractor.ts              # Message link parsing (~150 lines)
├── SnapshotFormatter.ts          # Forwarded messages (~150 lines)
├── TranscriptRetriever.ts        # Voice transcript lookup (~100 lines)
└── types.ts                      # Shared types (~50 lines)
```

**Important**: This file has 1416 lines of excellent test coverage. Must update tests during migration.

**Migration steps**:
1. Create directory structure
2. Extract each concern to separate file
3. Update main extractor to use new services
4. Refactor tests to match new structure
5. Ensure 100% test coverage maintained

---

### Task 3.3: Split AIJobProcessor
**Priority**: MEDIUM
**Effort**: 2-3 hours
**Current**: 613 lines → **Target**: ~300 lines

**Problem**: Single class routing multiple job types

**New structure**:
```
jobs/
├── AIJobProcessor.ts              # Base router (~150 lines)
├── handlers/
│   ├── LLMGenerationHandler.ts   # LLM generation (~300 lines)
│   ├── AudioTranscriptionHandler.ts  # Already exists ✅
│   └── ImageDescriptionHandler.ts    # Already exists ✅
└── utils/
    └── PreprocessingMerger.ts     # Dependency merging (~100 lines)
```

**Migration steps**:
1. Extract LLM generation to handler (follows existing pattern)
2. Extract preprocessing merger to utility
3. Update processor to use handlers
4. Add tests for new LLMGenerationHandler

---

### Task 3.4: Split MultimodalProcessor
**Priority**: LOW
**Effort**: 2 hours
**Current**: 513 lines → **Target**: ~250 lines

**Problem**: Mixes vision and audio processing

**New structure**:
```
services/multimodal/
├── index.ts              # Orchestrator (~100 lines)
├── VisionProcessor.ts    # Image description (~250 lines)
└── AudioProcessor.ts     # Whisper transcription (~250 lines)
```

---

### Task 3.5: Split DatabaseSyncService
**Priority**: LOW
**Effort**: 2 hours
**Current**: 551 lines → **Target**: ~300 lines

**Problem**: Large SYNC_CONFIG object mixed with logic

**New structure**:
```
services/sync/
├── DatabaseSyncService.ts   # Core logic (~300 lines)
├── config/
│   └── syncTables.ts        # Table configs (~150 lines)
└── utils/
    └── syncValidation.ts    # Validation (~100 lines)
```

---

## Phase 4: Utils to Classes

### Task 4.1: Convert requestDeduplication to Class
**Priority**: MEDIUM (memory leak risk)
**Effort**: 1.5 hours

**Problem**: Module-level Map with no cleanup, not testable

**Current**: `services/api-gateway/src/utils/requestDeduplication.ts`

**New implementation**:
```typescript
export class RequestDeduplicationCache {
  private cache = new Map<string, string>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private ttlMs: number = 60000) {
    this.startCleanup();
  }

  private startCleanup() {
    this.cleanupInterval = setInterval(() => {
      // Remove expired entries
    }, this.ttlMs);
  }

  public dispose() {
    clearInterval(this.cleanupInterval);
  }

  // ... cache methods
}
```

**Tests needed**:
- Deduplication works
- TTL cleanup works
- Dispose cleans up properly

---

### Task 4.2: Convert tempAttachmentStorage to Class
**Priority**: LOW
**Effort**: 1 hour

**Problem**: Hard to mock for testing, no centralized cleanup

**Current**: `services/api-gateway/src/utils/tempAttachmentStorage.ts`

**New**: `AttachmentStorageService` class with proper lifecycle

---

## Phase 5: Service Extraction

### Task 5.1: Extract PersonalityService Cache
**Priority**: LOW
**Effort**: 1.5 hours

**Problem**: PersonalityService does too much (loading, caching, LRU eviction, placeholder replacement)

**Extract**: ~100 lines of cache logic to `utils/PersonalityCache.ts`

---

### Task 5.2: Extract PromptBuilder Formatters
**Priority**: LOW
**Effort**: 2 hours

**Current**: 500 lines with multiple formatters in one class

**Extract** to separate formatters:
- `prompt/EnvironmentFormatter.ts`
- `prompt/ParticipantFormatter.ts`
- `prompt/MemoryFormatter.ts`

---

## Progress Tracking

### Metrics
- [ ] Files >500 lines: 7 → Target: 3
- [ ] Code duplication: ~600 lines → Target: <100 lines
- [ ] Test coverage gaps: 8 files → Target: 0 files
- [ ] Architectural issues: 3 → Target: 0

### Completed Tasks
*None yet*

### Current Focus
*Ready to start Phase 1*

---

## Testing Strategy

For every change:
1. **Write tests first** (or immediately after for refactors)
2. **Run full test suite** before committing
3. **Maintain >90% coverage** for new code
4. **Use Vitest patterns** from TESTING.md guide

Test requirements:
- Pure functions: Unit tests with edge cases
- Classes: Unit tests + integration tests
- Route handlers: Mock Prisma + BullMQ
- Command handlers: Mock Discord interactions
- Services: Mock dependencies, test behavior

---

## Commit Strategy

**Commit after each task completion**:
- Small, focused commits
- Descriptive messages following conventional commits
- Run tests before every commit
- Keep commits atomic (one logical change per commit)

**Example commit messages**:
```
refactor(api-gateway): use Prisma singleton throughout

Replace direct PrismaClient instantiation with getPrismaClient()
singleton from common-types. Prevents connection pool exhaustion.

Files updated:
- routes/admin.ts
- routes/ai.ts
- (9 files total)

Tests: All existing tests passing
```

---

## Notes & Decisions

### Why this order?
1. **Phase 1 (Quick Wins)** - Low risk, high impact, builds confidence
2. **Phase 2 (Tests)** - Establishes safety net before big refactors
3. **Phase 3 (Splitting)** - Can refactor safely with test coverage
4. **Phase 4-5 (Polish)** - Nice-to-haves after critical work done

### Estimated Timeline
- Phase 1: 3-4 hours (1 session)
- Phase 2: 9-12 hours (2-3 sessions)
- Phase 3: 11-15 hours (3-4 sessions)
- Phase 4: 3-4 hours (1 session)
- Phase 5: 4-6 hours (1-2 sessions)

**Total**: 30-41 hours (8-11 sessions)

### Success Criteria
- ✅ All tests passing
- ✅ No files >500 lines
- ✅ <100 lines of duplication
- ✅ All critical paths have tests
- ✅ Prisma singleton used everywhere
- ✅ Caching uses proper classes

---

*This document will be deleted after work is complete (git history preserves it)*
