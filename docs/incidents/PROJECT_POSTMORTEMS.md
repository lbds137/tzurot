# Project Post-Mortems & Lessons Learned (v3 Development)

> **Note**: Universal principles from these incidents have been promoted to `~/.claude/CLAUDE.md`. This document captures project-specific context and full incident details.

## Quick Reference - Key Rules Established

| Date       | Incident                        | Rule Established                                  |
| ---------- | ------------------------------- | ------------------------------------------------- |
| 2026-02-03 | Context settings not cascading  | Trace full runtime flow before declaring "done"   |
| 2026-01-30 | Gitignored data/ deleted        | NEVER rm -rf without explicit user approval       |
| 2026-01-30 | Work reverted without consent   | Never abandon uncommitted work without asking     |
| 2026-01-24 | execSync with string commands   | Use execFileSync with arrays for external data    |
| 2026-01-28 | Model footer missing on errors  | Both producer & consumer must be updated together |
| 2026-01-26 | Dashboard prefix not registered | Test componentPrefixes for dashboard entityTypes  |
| 2026-01-17 | Wrong branch migration deploy   | Run migrations from correct branch checkout       |
| 2026-01-17 | Dockerfile missed new package   | Use Grep Rule for all infrastructure files        |
| 2025-07-25 | Untested push broke develop     | Always run tests before pushing                   |
| 2025-07-21 | Git restore destroyed work      | Confirm before destructive git commands           |
| 2025-10-31 | DB URL committed                | Never commit database URLs                        |
| 2025-07-16 | DDD migration broke features    | Test actual behavior, not just units              |
| 2025-12-05 | Direct fetch broke /character   | Use gateway clients, not direct fetch             |
| 2025-12-06 | API contract mismatch           | Use shared Zod schemas for contracts              |
| 2025-12-14 | Random UUIDs broke db-sync      | Use deterministic v5 UUIDs for all entities       |

---

## 2026-02-03 - Context Settings Not Cascading Correctly

**What Happened**: Extended context settings (like `max_output_tokens`, `reasoning`) were not cascading through the personality → user-personality → user-default hierarchy. Settings set at one level were being ignored or overridden incorrectly at runtime.

**Root Cause**: The cascading config resolution logic was tested at the unit level but the full runtime flow — from API request through settings resolution to the actual LLM call — was never traced end-to-end. The unit tests verified each layer independently, but the integration between layers had subtle bugs in how `null` vs `undefined` vs explicit values were handled.

**Impact**: Users setting custom reasoning or token limits on their personality configs would get unexpected behavior — sometimes the defaults would override their explicit settings.

**Prevention**:

1. **Trace the full runtime flow** before declaring cascading features "done"
2. Add integration tests that verify settings at each cascade level reach the LLM call
3. Be explicit about `null` vs `undefined` semantics in config resolution

**Universal Lesson**: Unit tests passing on each layer does not guarantee the layers work together. For cascading/inheritance systems, always test the full stack.

---

## 2026-01-30 - Work Reverted Without User Consent

**What Happened**: During a session, uncommitted work was discarded without explicit user approval. The user's in-progress changes were lost when git operations were performed that assumed a clean working tree was desired.

**Root Cause**: Misinterpreted the user's intent regarding their working tree state. Performed git operations that discarded changes rather than preserving them.

**Impact**: Lost in-progress work that the user had been developing. Required reconstruction of changes.

**Prevention**:

1. **Never abandon uncommitted work without asking** — uncommitted changes represent hours of effort
2. When a user says "get changes" → COMMIT them, never DISCARD them
3. Always confirm before any git operation that modifies the working tree
4. When in doubt about intent, ask explicitly: "Should I commit these changes or discard them?"

**Universal Lesson**: Treat uncommitted changes as sacred. The default assumption should always be to preserve work, never to discard it.

---

## 2026-01-24 - execSync with String Command Injection Vulnerability

**What Happened**: Shell commands were being constructed using string interpolation with `execSync()`, creating a command injection vulnerability. User-supplied or dynamic values were interpolated directly into shell command strings.

**Root Cause**: Used `execSync(\`git commit -m "${message}"\`)`pattern instead of the safe`execFileSync('git', ['commit', '-m', message])` pattern. String interpolation in shell commands allows injection of arbitrary shell metacharacters.

**Impact**: Potential command injection vulnerability. While not exploited, this is a critical security anti-pattern that could allow arbitrary command execution.

**Prevention**:

1. **NEVER** use string interpolation in `execSync()` calls
2. Use `execFileSync(cmd, args)` when any argument contains external data
3. `execSync()` is only safe for fully static command strings with no interpolation
4. Added to `00-critical.md` security rules with examples table

**Universal Lesson**: Shell command construction is a common injection vector. Always pass arguments as arrays via `execFileSync`, never interpolate into strings.

---

## 2026-01-30 - Gitignored Data Directory Permanently Deleted

**What Happened**: During a v2 legacy cleanup task, `rm -rf` was used to delete directories including the gitignored `data/` folder containing irreplaceable Shapes.inc backup data. The user had only asked to clean up documentation files, not code or data.

**Root Cause**:

1. Interpreted "clean up v2 stuff" too broadly without asking for explicit file list
2. Did not check whether directories were gitignored before deleting
3. Did not list what would be deleted and wait for explicit approval
4. Assumed context instead of confirming specific scope

**Impact**:

- `data/` directory permanently lost (gitignored, not in git history)
- User had backup elsewhere, but this was pure luck
- Could have been catastrophic data loss

**What Was Lost**:

- Gitignored `data/` directory with Shapes.inc personality backups
- The v2 code (`src/`, `tests/`, `scripts/`) was also deleted but could be restored from git

**Why It Wasn't Prevented**:

- CLAUDE.md had "NEVER delete files without permission" but lacked specific guidance about `rm -rf`
- No protocol to check gitignore status before deletion
- No requirement to list files and wait for explicit approval

**Fix**:

1. Restored code from git: `git checkout 85e7f21f -- tzurot-legacy/src tzurot-legacy/tests tzurot-legacy/scripts`
2. Data directory could not be restored (user had external backup)

**Prevention** (added to CLAUDE.md):

- **NEVER use `rm -rf` without explicit user approval**
- Before ANY `rm` command: List what will be deleted and ASK
- Check if files/directories are gitignored - they CANNOT be restored from git
- When asked to "clean up", ask SPECIFICALLY which files/folders
- Prefer `mv` to temp location over `rm` when uncertain
- ALWAYS wait for explicit "yes, delete these" before proceeding

**Key Lesson**: Gitignored files are irreplaceable. Git's safety net does not catch them. Treat any `rm -rf` as a potentially destructive operation requiring explicit user consent.

---

## 2026-01-28 - Model Footer Missing on Error Responses

**What Happened**: Model footer (model used, guest mode indicator, etc.) was not displaying on error responses despite beta.55 changes that were supposed to enable this feature.

**Root Cause**: Gap between consumer and producer changes. Beta.55 added support for _passing_ `modelUsed` to error responses in `bot-client/MessageHandler.ts`, but this depended on `result.metadata?.modelUsed` being populated by the ai-worker. The ai-worker error paths were never updated to populate this field.

**Two error paths missed**:

1. `GenerationStep.ts:500` - Error metadata only had `{ processingTimeMs }`
2. `LLMGenerationHandler.ts:189-194` - Error metadata had debug info but no model info

The success path correctly included `modelUsed: response.modelUsed` in metadata.

**Impact**: Error messages showed without model footer for all users.

**Why It Wasn't Caught**:

1. No integration test verifying error responses include model metadata
2. The bot-client change was correct but useless without the ai-worker change
3. Manual testing likely focused on the happy path

**Fix**: Added `modelUsed`, `providerUsed`, and `isGuestMode` to error metadata in both error paths.

**Prevention**:

- When adding features that span multiple services, update ALL producers before the consumer
- Add test: "error responses should include modelUsed in metadata when available"
- Consider contract tests between services for critical fields

---

## 2026-01-17 - Wrong Branch Migration Deployment Broke Production LTM

**What Happened**: During a 2-phase database migration (OpenAI → local BGE embeddings), ran `prisma migrate deploy` from the wrong branch, applying BOTH Phase 1 and Phase 2 migrations at once. Production code was still expecting the Phase 1 schema, causing ~30 minutes of LTM storage failures.

**The Plan Was**:

1. Phase 1: Add `embedding_local` column, deploy code that writes to it
2. Run backfill script to populate `embedding_local`
3. Phase 2: Rename `embedding_local` → `embedding`, deploy code using new name

**What Actually Happened**:

1. Phase 1 PR merged to main, Railway deployed
2. Needed to run migrations manually (Railway doesn't auto-run them)
3. **MISTAKE**: Ran `prisma migrate deploy` from `develop` branch which had BOTH migrations
4. Both migrations applied: column added, then immediately renamed
5. Production code still referenced `embedding_local` which no longer existed
6. All LTM storage failed with: `column "embedding_local" of relation "memories" does not exist`

**Impact**:

- ~30 minutes of broken LTM storage in production
- Memory queries failed silently (returned empty results)
- New memories queued in `pending_memories` table (not lost, just delayed)
- Required emergency PR, rebase, and deployment to fix

**Root Cause**:

- **Misunderstanding**: `prisma migrate deploy` applies migrations from the LOCAL `prisma/migrations/` folder, NOT based on target database state or git branch
- Running from `develop` checkout meant it saw BOTH migrations as "pending"
- The careful 2-phase plan was undermined by running from wrong checkout

**Why It Wasn't Caught**:

- No explicit documentation that migrations come from LOCAL folder
- Easy to assume "deploy to prod" means "deploy what prod needs"
- Previous migration deployments happened to be from correct checkout
- No CI/CD pipeline for migrations (manual process)

**Mitigating Factors (What Saved Us)**:

1. **pending_memories table**: Failed storage attempts were queued for retry, not lost
2. **Column-agnostic backfill script**: Auto-detected schema state, worked regardless
3. **Swiss Cheese retry mechanism**: 10-minute scheduled job retried pending memories
4. **Quick diagnosis**: Error message clearly showed the column name mismatch

**Prevention Measures**:

1. **New Rule**: Before running `prisma migrate deploy`:
   - Verify you're on the correct branch/commit for the target deployment
   - Check `ls prisma/migrations/` to see what will be applied
   - Consider: "Does production code support ALL these schema changes?"

2. **Documentation Update**: Add to `tzurot-deployment` skill:

   ```
   ⚠️ CRITICAL: prisma migrate deploy uses LOCAL migrations folder
   - Checkout the branch that matches deployed code
   - Or checkout the specific commit/tag for that release
   - NEVER run from develop if main is deployed
   ```

3. **Workflow Improvement**: For multi-phase migrations:
   - Create separate PRs for each phase
   - Only checkout/run migrations from the merged PR's commit
   - Verify schema matches code expectations before proceeding

**Commands That Would Have Prevented This**:

```bash
# WRONG - develop has both migrations
git checkout develop
pnpm ops run --env prod prisma migrate deploy

# RIGHT - checkout the deployed code first
git checkout main
git pull origin main
pnpm ops run --env prod prisma migrate deploy
```

**Universal Lesson**: Prisma migrations are LOCAL-folder-driven, not database-state-driven. Always verify your checkout matches the deployment target before running `migrate deploy`.

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

---

## 2026-01-26 - Dashboard Prefix Not Registered (componentPrefixes Bug)

**What Happened**: The `/me profile edit` command showed "Unknown interaction" error when users clicked dashboard buttons. The profile dashboard's edit/close/delete buttons stopped working.

**Impact**:

- Profile editing broken for all users
- Dashboard buttons returned "Unknown interaction!"
- Users couldn't edit their personas via dashboard

**Root Cause**:

- Dashboard framework uses `entityType` as the first segment of customIds (e.g., `profile::menu::uuid`)
- Command routing uses `getCommandFromCustomId()` to find which command handles an interaction
- The `/me` command had `componentPrefixes: ['profile']` to register 'profile' as a routable prefix
- At some point during development, the componentPrefixes registration wasn't working correctly
- Interactions with `profile::*` customIds couldn't find their handler

**Why It Wasn't Caught**:

- Tests mocked at handler level, not at routing level
- No registry integrity test that verified componentPrefixes were registered
- Manual testing didn't cover all dashboard flows

**The Fix - New Command Structure**:

Instead of relying on `componentPrefixes` hack, restructured commands so command name = entityType:

```typescript
// OLD: Command name 'me' needs componentPrefixes: ['profile']
// Dashboard uses entityType: 'profile' -> customIds like 'profile::menu::...'
// Requires hack to route 'profile' prefix to 'me' command

// NEW: Command name 'persona' matches entityType
// Dashboard uses entityType: 'persona' -> customIds like 'persona::menu::...'
// Routing works naturally via command name prefix
```

**Prevention Measures Added**:

1. **Registry Integrity Tests**: Added to `CommandHandler.component.test.ts` - verifies all componentPrefixes are properly registered

2. **Command Structure Snapshots**: Track command structure changes with snapshots to catch unintended modifications

3. **New Commands Created**:
   - `/persona` - replaces `/me profile *`, entityType matches command name
   - `/settings` - consolidates timezone, apikey, preset settings

4. **Testing Skill Updated**: Added "Registry Integrity Tests" and "Command Structure Snapshots" sections

**Universal Lesson**: When dashboard entityType differs from command name, the componentPrefixes mechanism is fragile. Prefer designs where command name = entityType for natural routing.
