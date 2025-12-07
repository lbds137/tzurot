# Code Quality Sprint - December 2025

> **Status**: IN PROGRESS
> **Started**: 2025-12-06
> **Goal**: Eliminate all ESLint warnings and achieve 80% test coverage minimum

## Root Cause Analysis

Production bugs were caused by:

1. **Untested code paths** - 1242-line `character/index.ts` had NO tests
2. **Orphaned ESLint configs** - Module size rules existed but were never integrated
3. **No enforcement** - Coverage requirements weren't blocking PRs

## Phase 1: Workflow Enforcement ✅

- [x] Integrate orphaned ESLint module-size rules into `eslint.config.js`
  - `max-lines: 500` (error)
  - `max-lines-per-function: 100` (warn)
  - `complexity: 15` (warn)
  - `max-depth: 4` (warn)
  - `max-params: 5` (warn)
  - `max-statements: 30` (warn)
  - `max-nested-callbacks: 3` (warn)
- [x] Create `scripts/testing/check-untested-files.js`
- [x] Add untested files check to pre-push hook (informational for now)
- [x] Install updated hooks

## Phase 2: Split Oversized Files

### Priority 1: character/index.ts (1242 → 171 lines) ✅

**Why Priority 1**: This file caused the production bug - no tests = no safety net.

- [x] Create `api.ts` - API client functions (fetchCharacter, createCharacter, etc.)
- [x] Create `list.ts` - List handlers (handleList, handleListPagination, escapeMarkdown)
- [x] Create `create.ts` - Create handlers (handleCreate, handleSeedModalSubmit)
- [x] Create `dashboard.ts` - Dashboard interaction handlers (handleSelectMenu, handleButton, handleAction)
- [x] Create `edit.ts` - Edit dashboard opener (handleEdit)
- [x] Create `avatar.ts` - Avatar upload handler (handleAvatar)
- [x] Update `index.ts` to import from extracted files
- [x] Verify all exports still work (typecheck passes)
- [x] Remove eslint-disable comment (file now 171 lines - just routing)
- [x] Create `api.test.ts` with permission check tests (16 tests)
- [x] Create `list.test.ts` (15 tests)
- [x] Create `create.test.ts` (9 tests)
- [x] Create `dashboard.test.ts` (14 tests)
- [x] Create `edit.test.ts` (6 tests)
- [x] Create `avatar.test.ts` (13 tests)

### Priority 2: persona.ts (649 lines)

- [ ] Analyze structure and plan split
- [ ] Create separate route modules
- [ ] Update index.ts imports
- [ ] Remove eslint-disable comment
- [ ] Add tests

### Priority 3: personality.ts (648 lines)

- [ ] Analyze structure and plan split
- [ ] Create separate route modules
- [ ] Update index.ts imports
- [ ] Remove eslint-disable comment
- [ ] Add tests

## Phase 3: Cover Remaining Untested Files

Original count: 14 files without tests → **All files now tested!**

| Lines | File                                                  | Priority | Status             |
| ----- | ----------------------------------------------------- | -------- | ------------------ |
| 1242  | bot-client/commands/character/index.ts                | P1       | ✅ Split + Tested  |
| 183   | ai-worker/jobs/PendingMemoryProcessor.ts              | P2       | ✅ Done (14 tests) |
| 176   | bot-client/commands/character/export.ts               | P2       | ✅ Done (13 tests) |
| 154   | bot-client/commands/me/model/set.ts                   | P2       | ✅ Done (9 tests)  |
| 147   | ai-worker/jobs/utils/conversationUtils.ts             | P2       | ✅ Done (20 tests) |
| 111   | ai-worker/services/RedisService.ts                    | P2       | ✅ Done (16 tests) |
| 90    | bot-client/commands/preset/global/edit.ts             | P3       | ✅ Done (8 tests)  |
| 90    | ai-worker/jobs/CleanupJobResults.ts                   | P3       | ✅ Done (11 tests) |
| 75    | ai-worker/services/context/PromptContext.ts           | P3       | N/A (types only)   |
| 70    | bot-client/commands/preset/global/create.ts           | P3       | ✅ Done (7 tests)  |
| 68    | bot-client/commands/me/model/list.ts                  | P3       | ✅ Done (6 tests)  |
| 62    | bot-client/commands/preset/global/set-default.ts      | P3       | ✅ Done (5 tests)  |
| 62    | bot-client/commands/preset/global/set-free-default.ts | P3       | ✅ Done (5 tests)  |
| 53    | bot-client/commands/me/model/reset.ts                 | P3       | ✅ Done (4 tests)  |

## Phase 4: Coverage Enforcement ✅

- [x] Update codecov.yml to require 80% minimum (project and patch targets)
- [x] Change untested files check to --strict mode in pre-push hook
- [x] Add routing-only and types-only files to KNOWN_UNTESTED
- [ ] ~~Add `pnpm test:coverage` to pre-push hook~~ (Skipped - Codecov already enforces on PRs)
- [ ] ~~Update CLAUDE.md with coverage requirements~~ (Skipped - existing docs sufficient)

## Phase 5: Fix Remaining ESLint Warnings

After Phase 2-4 complete, run `pnpm lint` and address remaining warnings:

- [ ] `max-lines-per-function` warnings
- [ ] `complexity` warnings
- [ ] `max-params` warnings
- [ ] `max-statements` warnings
- [ ] `max-depth` warnings

## Success Criteria

1. Zero ESLint errors (already achieved)
2. Zero ESLint warnings
3. 80%+ test coverage across all services
4. No files >500 lines
5. No untested files with >50 lines of business logic
6. Pre-push hook blocks on quality failures

## Commands Reference

```bash
# Check current untested files
node scripts/testing/check-untested-files.js

# Run lint with warnings
pnpm lint

# Check coverage
pnpm test:coverage

# Run tests for specific service
pnpm --filter @tzurot/bot-client test

# Verify character/index.ts line count
wc -l services/bot-client/src/commands/character/index.ts
```

## Session Notes

### 2025-12-06 Session 1

- Discovered 4 orphaned ESLint configs that were never integrated
- Integrated module size rules into eslint.config.js
- Created check-untested-files.js script
- Found 14 source files without tests
- Started splitting character/index.ts (extracted api.ts, list.ts)

### 2025-12-06 Session 2 (Continued)

- Completed character/index.ts split (1242 → 312 lines)
  - api.ts (257 lines) - 16 tests
  - list.ts (229 lines) - 15 tests
  - create.ts (137 lines) - 9 tests
  - dashboard.ts (378 lines) - 14 tests
- Total test count: 3511 tests across all services
- bot-client tests: 1231 tests
- All tests enforce contracts (canEdit permission check, error handling)
- Fixed pre-push hook installation issue
- Committed and pushed: 6282312e

### 2025-12-06 Session 3 (Continued)

- Added tests for 4 P2 priority untested files:
  - character/export.ts - 13 tests
  - PendingMemoryProcessor.ts - 14 tests
  - me/model/set.ts - 9 tests
  - conversationUtils.ts - 20 tests
- Total test count: 3566 tests across all services (+55 new)
  - common-types: 776 tests
  - api-gateway: 745 tests
  - ai-worker: 792 tests
  - bot-client: 1253 tests
- Remaining untested files: 10 (down from 14)

### 2025-12-06 Session 4 (Continued)

- Completed Phase 3 - all remaining untested files now have tests:
  - RedisService.ts - 16 tests (stream publishing, job result storage, retrieval, error handling)
  - CleanupJobResults.ts - 11 tests (probabilistic cleanup, threshold-based cleanup, error handling)
  - preset/global/edit.ts - 8 tests (partial updates, no fields error, API errors)
  - preset/global/create.ts - 7 tests (creation, default provider, API errors)
  - preset/global/set-default.ts - 5 tests (default setting, API errors)
  - preset/global/set-free-default.ts - 5 tests (free tier default, API errors)
  - me/model/list.ts - 6 tests (empty state, list display, unknown config)
  - me/model/reset.ts - 4 tests (reset success, API errors)
  - PromptContext.ts - N/A (types only, no executable code)
- Total test count: 3628 tests across all services (+62 new)
  - common-types: 776 tests
  - api-gateway: 745 tests
  - ai-worker: 819 tests (+27)
  - bot-client: 1288 tests (+35)
- **Phase 3 COMPLETE** - All 14 originally untested files now have tests or are type-only

### 2025-12-07 Session 5 (Continued)

- Further split character/index.ts (312 → 171 lines):
  - Extracted `edit.ts` (82 lines) - handleEdit dashboard opener
  - Extracted `avatar.ts` (93 lines) - handleAvatar upload handler
  - index.ts now contains only command definition + routing
- Added tests for new handlers:
  - edit.test.ts - 6 tests (dashboard opening, permissions, errors)
  - avatar.test.ts - 13 tests (validation, permissions, upload, errors)
- Phase 4 Coverage Enforcement:
  - Updated codecov.yml: 80% target for project and patch coverage
  - Enabled --strict mode in pre-push hook for untested files check
  - Added character/index.ts (routing-only) and PromptContext.ts (types-only) to KNOWN_UNTESTED
- Total test count: 1306 bot-client tests (+18 new)
- **Phase 4 COMPLETE**
