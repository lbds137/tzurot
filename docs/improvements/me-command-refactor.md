# /me Command Refactor Plan

**Created**: 2025-12-06
**Completed**: 2025-12-06
**Branch**: `refactor/me-commands-and-autocomplete`
**Status**: ✅ Complete

## Problem Statement

The `/me` command group has significant architectural issues that need to be addressed before production release:

1. **Gateway Bypass**: All `/me` commands use direct Prisma calls instead of the API gateway
2. **Inconsistent Autocomplete**: 3 different personality autocomplete implementations with different behaviors
3. **Command Structure**: Some subcommand groups (`override`, `settings`) should be under `profile`
4. **SRP Violations**: Some files contain multiple unrelated handlers

## Audit Findings

### 1. Gateway Bypass (Critical)

**Files using `getPrismaClient` directly (should use gateway):**

- `me/autocomplete.ts` - Personality and persona autocomplete
- `me/create.ts` - Create user persona/profile
- `me/default.ts` - Set default persona
- `me/edit.ts` - Edit user persona
- `me/list.ts` - List user personas
- `me/override.ts` - Set/clear profile overrides
- `me/settings.ts` - Toggle share-ltm setting
- `me/view.ts` - View user persona

**Files correctly using gateway (`callGatewayApi`):**

- `me/timezone.ts` - Uses gateway for user settings
- `me/model/*` - All model override commands use gateway

**Root Cause**: No `/user/persona` gateway endpoints exist. The gateway has `/user/personality` (AI characters) but not `/user/persona` (user profiles).

### 2. Autocomplete Inconsistency

| File                         | API Method        | Visibility Indicators               | Return Value |
| ---------------------------- | ----------------- | ----------------------------------- | ------------ |
| `/character/autocomplete.ts` | `callGatewayApi`  | 🌐 public, 🔒 private, 📖 not-owned | `slug`       |
| `/me/autocomplete.ts`        | **Direct Prisma** | None                                | `slug`       |
| `/me/model/autocomplete.ts`  | `callGatewayApi`  | None                                | `id`         |

**Issues:**

- Direct Prisma bypasses authorization checks
- Inconsistent return values (`slug` vs `id`)
- Missing visibility indicators in `/me` commands
- Three separate implementations = maintenance burden

### 3. Command Structure Issues

**Current structure:**

```
/me profile view|edit|create|list|default   (5 subcommands)
/me settings share-ltm                       (1 subcommand - orphaned)
/me timezone set|get                         (2 subcommands)
/me override set|clear                       (2 subcommands - profile-related)
/me model list|set|reset|set-default|clear-default (5 subcommands)
```

**Problems:**

- `/me settings share-ltm` - This is a profile-level setting, should be under `profile`
- `/me override set|clear` - This maps profiles to personalities, should be under `profile`
- `settings` group has only 1 command (weird UX)

**Proposed structure:**

```
/me profile view|edit|create|list|default|share-ltm|override-set|override-clear (8 subcommands)
/me timezone set|get                         (2 subcommands)
/me model list|set|reset|set-default|clear-default (5 subcommands)
```

### 4. Files with Multiple Handlers

Files that may violate SRP (multiple handlers in one file):

| File                 | Handlers | Assessment                            |
| -------------------- | -------- | ------------------------------------- |
| `me/autocomplete.ts` | 2        | OK - both are autocomplete related    |
| `me/create.ts`       | 2        | OK - command + modal submit           |
| `me/edit.ts`         | 2        | OK - command + modal submit           |
| `me/override.ts`     | 3        | **Split?** - set, clear, modal submit |
| `me/timezone.ts`     | 2        | OK - set + get are related            |
| `me/view.ts`         | 2        | OK - view + expand button             |
| `character/view.ts`  | 3        | Review needed                         |

## Implementation Plan

### Phase 1: Gateway Endpoints for Persona

Create new routes in `api-gateway/src/routes/user/`:

**`persona.ts`** - User persona/profile CRUD:

```
GET    /user/persona           - List user's personas
GET    /user/persona/:id       - Get specific persona
POST   /user/persona           - Create new persona
PUT    /user/persona/:id       - Update persona
DELETE /user/persona/:id       - Delete persona
PATCH  /user/persona/:id/default - Set as default
```

**`persona-override.ts`** - Profile-to-personality mapping:

```
GET    /user/persona-override              - List all overrides
GET    /user/persona-override/:personalityId - Get override for personality
PUT    /user/persona-override/:personalityId - Set override
DELETE /user/persona-override/:personalityId - Clear override
```

**`persona-settings.ts`** - Persona settings:

```
GET   /user/persona-settings        - Get all settings
PATCH /user/persona-settings        - Update settings (share-ltm, etc.)
```

### Phase 2: Shared Autocomplete Utility

Create `bot-client/src/utils/autocomplete/personalityAutocomplete.ts`:

```typescript
interface PersonalityAutocompleteOptions {
  /** Filter to only owned personalities */
  ownedOnly?: boolean;
  /** Include visibility indicators (🌐/🔒/📖) */
  showVisibility?: boolean;
  /** Return value format */
  valueFormat?: 'slug' | 'id';
  /** Filter by subcommand context */
  subcommand?: string;
}

export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction,
  options?: PersonalityAutocompleteOptions
): Promise<void>;
```

Update all commands to use this shared utility.

### Phase 3: Refactor /me Commands to Use Gateway

For each file in `/me`:

1. Replace `getPrismaClient()` with `callGatewayApi()`
2. Update error handling to match gateway response format
3. Update tests to mock gateway instead of Prisma

### Phase 4: Restructure Command Groups

1. Move `share-ltm` from `/me settings` to `/me profile share-ltm`
2. Move `set|clear` from `/me override` to `/me profile override-set|override-clear`
3. Remove empty `settings` and `override` groups
4. Update `index.ts` command builder
5. Update all handler imports and routing

### Phase 5: Update Tests

- Update all `/me` command tests to mock gateway instead of Prisma
- Add integration tests for new gateway endpoints
- Ensure autocomplete tests verify consistent behavior

## Files to Create

```
services/api-gateway/src/routes/user/persona.ts
services/api-gateway/src/routes/user/persona.test.ts
services/api-gateway/src/routes/user/persona-override.ts
services/api-gateway/src/routes/user/persona-override.test.ts
services/api-gateway/src/routes/user/persona-settings.ts
services/api-gateway/src/routes/user/persona-settings.test.ts
services/bot-client/src/utils/autocomplete/personalityAutocomplete.ts
services/bot-client/src/utils/autocomplete/personalityAutocomplete.test.ts
```

## Files to Modify

```
services/api-gateway/src/routes/user/index.ts  (add new routes)
services/bot-client/src/commands/me/index.ts   (restructure groups)
services/bot-client/src/commands/me/autocomplete.ts
services/bot-client/src/commands/me/create.ts
services/bot-client/src/commands/me/default.ts
services/bot-client/src/commands/me/edit.ts
services/bot-client/src/commands/me/list.ts
services/bot-client/src/commands/me/override.ts
services/bot-client/src/commands/me/settings.ts
services/bot-client/src/commands/me/view.ts
services/bot-client/src/commands/me/model/autocomplete.ts
services/bot-client/src/commands/character/autocomplete.ts
```

## Success Criteria

- [x] All `/me` commands use gateway API (no direct Prisma)
- [x] Single shared personality autocomplete utility
- [x] Consistent visibility indicators across all commands
- [x] Consistent return value format (slug)
- [x] `/me profile` contains all profile-related subcommands
- [x] No orphaned single-command groups
- [x] All tests pass (3386 tests across 198 files)
- [x] No regressions in functionality

## Final File Structure

```
commands/me/
├── index.ts, index.test.ts       # Command registration & routing
├── autocomplete.ts, autocomplete.test.ts
├── profile/                       # /me profile <subcommand>
│   ├── view.ts, edit.ts, create.ts, list.ts, default.ts
│   ├── share-ltm.ts              # Formerly /me settings share-ltm
│   ├── override-set.ts           # Formerly /me override set
│   ├── override-clear.ts         # Formerly /me override clear
│   ├── utils/modalBuilder.ts     # Shared modal building (DRY)
│   └── *.test.ts
├── timezone/                      # /me timezone <subcommand>
│   ├── set.ts, get.ts
│   ├── utils.ts                  # Shared timezone helper (DRY)
│   └── *.test.ts
└── model/                         # /me model <subcommand> (unchanged)
    └── ...
```

## Estimated Effort

- Phase 1 (Gateway endpoints): 1-2 sessions
- Phase 2 (Shared autocomplete): 0.5 session
- Phase 3 (Refactor commands): 1-2 sessions
- Phase 4 (Restructure groups): 0.5 session
- Phase 5 (Update tests): 1 session

**Total: 4-6 sessions**

## Notes

- This is NOT a breaking change since commands haven't been deployed to production yet
- Only the dev bot has been used for testing
- Goal is rock-solid commands before production release
- General principle: **Always use API gateway, never direct Prisma from bot-client**
