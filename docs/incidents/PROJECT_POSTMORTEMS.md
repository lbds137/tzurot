# Project Post-Mortems & Lessons Learned (v3 Development)

> **Note**: Universal principles from these incidents have been promoted to `~/.claude/CLAUDE.md`. This document captures project-specific context and full incident details.

## Quick Reference - Key Rules Established

| Date       | Incident                      | Rule Established                            |
| ---------- | ----------------------------- | ------------------------------------------- |
| 2026-01-17 | Dockerfile missed new package | Use Grep Rule for all infrastructure files  |
| 2025-07-25 | Untested push broke develop   | Always run tests before pushing             |
| 2025-07-21 | Git restore destroyed work    | Confirm before destructive git commands     |
| 2025-10-31 | DB URL committed              | Never commit database URLs                  |
| 2025-07-16 | DDD migration broke features  | Test actual behavior, not just units        |
| 2025-12-05 | Direct fetch broke /character | Use gateway clients, not direct fetch       |
| 2025-12-06 | API contract mismatch         | Use shared Zod schemas for contracts        |
| 2025-12-14 | Random UUIDs broke db-sync    | Use deterministic v5 UUIDs for all entities |

---

## 2026-01-17 - Dockerfile Missed New Package During Epic Merge

**What Happened**: After merging PR #473 (Duplicate Detection Epic), Railway deployment failed because the new `@tzurot/embeddings` package wasn't included in the Dockerfiles.

**Error**:

```
Error: Cannot find package '@tzurot/embeddings' imported from /app/services/api-gateway/dist/index.js
```

**Impact**:

- Both api-gateway and ai-worker deployments failed
- Required emergency hotfix directly to develop branch
- Delayed deployment of duplicate detection feature

**Root Cause**:

- Created new `@tzurot/embeddings` package in `packages/`
- Updated only 2 of 3 Dockerfiles initially (api-gateway and ai-worker)
- Forgot to add the package build step and dist copy to the Dockerfiles
- When hotfixing, only fixed 2 Dockerfiles, not all 3

**Why It Wasn't Caught**:

- CI runs tests and builds in the normal monorepo structure (pnpm workspaces)
- Railway builds use Dockerfiles which have separate, manual package lists
- No automated check verifies Dockerfiles include all workspace dependencies
- Manual process = easy to forget when adding packages

**Prevention Measures**:

1. **Implemented turbo prune**: All Dockerfiles now use `turbo prune @tzurot/service-name --docker` which automatically includes workspace dependencies
2. **Added "Grep Rule" to CLAUDE.md**: Before modifying infrastructure, search for ALL instances
3. **Documented in deployment skill**: New "Docker Build Architecture" section explains the pattern
4. **Post-mortem added**: This incident documented for future reference

**The Fix - Turbo Prune**:

```dockerfile
# OLD: Manual package lists (error-prone)
COPY packages/common-types/package.json ./packages/common-types/
RUN pnpm --filter @tzurot/common-types build

# NEW: Automatic dependency handling
RUN turbo prune @tzurot/service-name --docker
COPY --from=pruner /app/out/json/ .
RUN pnpm turbo run build --filter=@tzurot/service-name...
```

**Universal Lesson**: When modifying infrastructure files (Dockerfiles, CI, configs), always search for ALL instances and verify complete coverage. Better yet, use tooling (like turbo prune) that handles dependencies automatically.

---

## 2025-07-25 - The Untested Push Breaking Develop

**What Happened**: Made "simple" linter fixes to timer patterns in rateLimiter.js and pushed without running tests

**Impact**:

- Broke the develop branch
- All tests failing
- Required emergency reverts
- Blocked other development work

**Root Cause**:

- Assumed "simple" refactors don't need testing
- Changed module-level constants that tests relied on
- Didn't realize tests depended on Jest's ability to mock inline functions

**Prevention Measures Added**:

1. ALWAYS run tests before pushing (no exceptions for "simple" changes)
2. Timer pattern fixes need corresponding test updates
3. When changing core utilities, run their specific test suite first
4. Module-level constants: verify tests can still mock them

**Universal Lesson**: Added to user-level CLAUDE.md - "Before ANY Push to Remote" rules

---

## 2025-07-21 - The Git Restore Catastrophe

**What Happened**: User said "get all the changes on that branch" - I ran `git restore .` and destroyed hours of uncommitted work on the database schema and interaction logic.

**Impact**:

- Lost approximately 4 hours of development work
- Ruined user's entire evening
- Required painful reconstruction from console history
- Affected user's personal life due to stress

**Root Cause**:

- Misunderstood "get changes on branch" as "discard changes" instead of "commit changes"
- Made destructive assumption without asking for clarification
- Failed to recognize that uncommitted changes represent hours of valuable work

**Prevention Measures Added**:

1. **When user says "get changes on branch"** -> They mean COMMIT them, not DISCARD them
2. **ALWAYS ask before ANY git command that discards work**:
   - `git restore` -> "This will discard changes. Do you want to commit them first?"
   - `git reset` -> "This will undo commits/changes. Are you sure?"
   - `git clean` -> "This will delete untracked files. Should I list them first?"
3. **Uncommitted changes = HOURS OF WORK** -> Treat them as sacred
4. **When in doubt** -> ASK, don't assume

**Universal Lesson**: The core principle "Always confirm before destructive Git commands" was promoted to user-level CLAUDE.md as a permanent, universal rule.

---

## 2025-10-31 - Database URL Committed to Git History

**What Happened**: Committed PostgreSQL database URL (with password) to git history, requiring immediate secret rotation.

**Prevention**:

- **NEVER** commit database URLs - they contain passwords
- **NEVER** commit connection strings for PostgreSQL, Redis, etc.
- **ALWAYS** use environment variables or placeholders in scripts
- **ALWAYS** review commits for credentials before pushing
- Database URL format contains password: `postgresql://user:PASSWORD@host:port/db`
- Even in bash command examples, use `$DATABASE_URL` not raw URLs

---

## 2025-07-16 - DDD Authentication Migration Broke Core Features

**What Happened**: DDD refactor changed return values and broke AI routing (45+ test failures).

**Prevention**:

- Test actual behavior, not just unit tests
- Verify API contracts remain unchanged
- Check return value formats match exactly
- Run full integration tests after refactors

---

## 2025-12-05 - Direct Fetch Calls Broke Character Commands

**What Happened**: The /character commands (edit, view, list, create) couldn't find any personalities. Users got "character not found" for all their own characters.

**Impact**:

- All /character functionality broken in production
- Users unable to manage their AI personalities
- Confusion and frustration for users
- Required emergency investigation and fix

**Root Cause**:

- Character commands used direct `fetch()` calls instead of the established `callGatewayApi` utility
- Wrong header name: `X-Discord-User-Id` instead of `X-User-Id`
- API gateway couldn't authenticate users -> returned 403/empty results
- Tests mocked at high level (`callGatewayApi`) so didn't catch the actual HTTP issues
- No tests existed for the internal fetch functions

**Why It Wasn't Caught**:

- Autocomplete used `callGatewayApi` (correct) -> worked fine, giving false confidence
- Character CRUD used direct `fetch` (wrong) -> silently failed auth
- Unit tests mocked too broadly, never tested actual headers
- No integration tests that verified HTTP headers

**Prevention Measures Added**:

1. Added "Gateway Client Usage (CRITICAL)" section to CLAUDE.md
2. Documented the THREE gateway clients and when to use each
3. Clear examples of correct vs wrong patterns
4. Header reference: `X-User-Id` NOT `X-Discord-User-Id`
5. Refactored character commands to use `callGatewayApi` (already tested)

**Universal Lesson**: When established utilities exist, USE THEM. Don't reinvent direct calls.

---

## 2025-12-06 - API Contract Mismatch in /me Commands

**What Happened**: Profile override-set (`/me profile override-set`) and character creation (`/character create`) failed in production. Bot-client expected response shapes that didn't match what gateway returned.

**Impact**:

- Profile override functionality broken
- Character creation dashboard showed incomplete data
- Required emergency fixes to two gateway endpoints

**Root Cause**:

- Gateway routes were created with certain response shapes (e.g., `{ message, personalitySlug, personaId }`)
- Bot-client was updated to call those routes expecting DIFFERENT shapes (e.g., `{ success, personality, persona }`)
- Bot-client tests mocked `callGatewayApi` with **assumed** response shapes
- Gateway tests mocked Prisma and verified gateway logic
- **Neither side verified the actual contract between them**
- Tests passed on both sides because they tested different contracts!

**Specific Issues**:

1. Bot-client test mocked `GET /user/persona/override/:slug` - endpoint that never existed
2. Gateway PUT returned minimal data, bot expected full objects
3. Gateway POST returned `{ id, slug }`, bot needed 20+ fields for dashboard

**Why It Wasn't Caught**:

- 106 mocked gateway responses in bot-client tests - all based on assumptions
- No shared types or schemas between services
- No integration tests verifying actual HTTP responses
- AI (Claude) wrote both sides in same session, assumed it knew what gateway returned

**Prevention Measures**:

1. **Shared Zod Schemas**: Define response shapes in `common-types/schemas/api/`
2. **Validated Mock Factories**: Create factories that validate mocks against schemas
3. **Runtime Validation**: Gateway uses `Schema.parse()` before sending responses
4. **New Rule**: NEVER manually construct JSON mocks for API responses - use factories
5. **New Rule**: When writing API consumer code, READ the actual response code first

**Implementation**: See `docs/improvements/api-contract-enforcement.md` for full plan.

**Universal Lesson**: Tests that mock external dependencies can give false confidence. Shared contracts (Zod schemas) catch mismatches at test time instead of production.

---

## Why v3 Abandoned DDD

**Lesson**: DDD was over-engineered for a one-person project. It caused:

- Circular dependency issues
- Excessive abstraction layers
- Complex bootstrap/wiring
- More time fixing architecture than building features

**v3 Approach**: Simple classes, constructor injection, clear responsibilities. Ship features, not architecture.

---

## 2025-12-14 - Random UUIDs Broke Database Sync

**What Happened**: Database sync between dev and prod failed with duplicate key constraint violation on `user_personality_configs`.

**Error**:

```
duplicate key value violates unique constraint "user_personality_configs_user_id_personality_id_key"
```

**Impact**:

- Database sync completely blocked
- Manual intervention required to fix UUIDs in both databases

**Root Cause**:

- `UserPersonalityConfig` records were created with Prisma's `@default(uuid())` instead of deterministic UUIDs
- A function `generateUserPersonalityConfigUuid()` existed but was never used
- Same user + personality combo got different random UUIDs in dev vs prod
- Sync tried to insert dev's record into prod, violating the `(user_id, personality_id)` unique constraint

**Why It Wasn't Caught**:

- The deterministic UUID generator existed but wasn't imported/used in the route handlers
- No lint rule or test to enforce deterministic UUID usage
- Tests passed because they mocked Prisma, not the actual ID generation

**Prevention Measures**:

1. **Fixed**: Updated `model-override.ts` and `persona.ts` to explicitly pass deterministic IDs
2. **Added CLAUDE.md Section**: "Deterministic UUIDs Required" with examples and anti-patterns
3. **Updated deterministicUuid.ts**: Added prominent header warning
4. **Added Test Assertions**: Tests now verify v5 UUID format in create calls
5. **Sync Config**: Changed `user_personality_configs` pk to composite `[user_id, personality_id]` as fallback

**Manual Remediation**:

```sql
-- Computed deterministic UUIDs using generateUserPersonalityConfigUuid()
-- Applied to both dev and prod databases
UPDATE user_personality_configs SET id = '<v5-uuid>' WHERE user_id = '...' AND personality_id = '...';
```

**Universal Lesson**: When a deterministic UUID generator exists, it MUST be used at all creation points. Having the function is useless if the code doesn't call it.
