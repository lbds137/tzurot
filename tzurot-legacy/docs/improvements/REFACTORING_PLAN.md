# Pragmatic Refactoring Plan

## Goal

Make the codebase less painful to work with, especially for adding features like voice toggle, without massive architectural changes.

## Current Pain Points

1. **Message content gets modified in multiple places** - Hard to track what the final prompt looks like
2. **Three separate code paths** (DMs, mentions, activated channels) with duplicated logic
3. **Massive files**: webhookManager.js (2800 lines), aiService.js (1700 lines), messageHandler.js (766 lines)
4. **Configuration scattered everywhere** - No central place for user/guild settings
5. **DDD migration half-done** - Two parallel systems that don't talk to each other

## Bite-Sized Refactorings (In Priority Order)

### Phase 1: Create a Request Context Object (1-2 hours)

**Why First**: This unblocks everything else. Once we have a context object, we can pass settings and modifications through the entire flow.

**What**:

- Create a `RequestContext` object in messageHandler.js that contains:
  - Original message
  - Working content (gets modified)
  - Source type (dm/mention/activated)
  - User/guild/channel info
  - Settings (empty for now)
  - Response placeholder

**Files to touch**:

- `src/handlers/messageHandler.js` (create context)
- Start with ONE downstream function to accept context

**Success metric**: Can pass context through one complete flow without breaking

### Phase 2: Content Processing Pipeline (2-3 hours)

**Why Second**: This directly addresses the voice toggle problem - we need ONE place to modify content.

**What**:

- Create `src/utils/contentProcessor.js`
- Move content modifications into pipeline steps:
  1. Strip mentions
  2. Add voice prefix (if enabled)
  3. Add context metadata
  4. Trim/clean
- Each step is a pure function: `(ctx) => ctx`

**Files to touch**:

- Create `src/utils/contentProcessor.js`
- Update `messageHandler.js` to use pipeline
- Update `personalityHandler.js` to stop doing its own modifications

**Success metric**: All content modifications happen in ONE place

### Phase 3: Simple Config Service (2-3 hours)

**Why Third**: Voice toggle needs somewhere to store user preferences.

**What**:

- Create `src/services/configService.js`
- Start with JSON file storage (`data/userPrefs.json`)
- Functions:
  - `getUserPrefs(userId)`
  - `setUserPref(userId, key, value)`
  - `getGuildSettings(guildId)`
- Add to RequestContext

**Files to touch**:

- Create `src/services/configService.js`
- Update `messageHandler.js` to load settings into context
- Create `data/userPrefs.json`

**Success metric**: Can store and retrieve a user's voice preference

### Phase 4: AI Adapter Facade (3-4 hours)

**Why Fourth**: Clean interface for AI calls makes adding features predictable.

**What**:

- Create `src/adapters/aiAdapter.js`
- Single clean function: `getAiResponse(ctx)`
- Handles all the messy aiService.js interaction
- Returns standardized response

**Files to touch**:

- Create `src/adapters/aiAdapter.js`
- Update ONE handler to use adapter instead of direct aiService calls

**Success metric**: One code path uses clean adapter instead of messy aiService

### Phase 5: Extract Response Formatting (2-3 hours)

**Why Fifth**: Separates Discord formatting from AI logic.

**What**:

- Create `src/utils/responseFormatter.js`
- Move webhook payload building logic
- Functions:
  - `formatWebhookPayload(aiResponse, personality)`
  - `formatDirectMessage(aiResponse)`

**Files to touch**:

- Create `src/utils/responseFormatter.js`
- Extract formatting from `webhookManager.js`
- Update one flow to use formatter

**Success metric**: Response formatting logic in one place

## What This Enables

After these 5 phases (10-15 hours total):

1. **Voice Toggle becomes trivial**:
   - Add `voiceEnabled` to user prefs (Phase 3)
   - Add voice prefix step to pipeline (Phase 2)
   - Done!

2. **Future features are easier**:
   - User timezone: Add to config service
   - Command ordering: Add to content pipeline
   - Multiple personalities: Clear where to loop

3. **Code is more maintainable**:
   - Know where to look for things
   - Can test pieces in isolation
   - Can modify without fear

## NOT Doing (Yet)

- **Not touching DDD migration** - Leave it as-is
- **Not breaking apart entire webhookManager** - Just extract formatting
- **Not rewriting aiService** - Just facade it
- **Not moving to database** - JSON files are fine for now
- **Not changing Discord.js patterns** - Keep what works

## How to Start

1. **Branch**: `refactor/request-context`
2. **First commit**: Just create RequestContext type
3. **Second commit**: Use it in ONE place
4. **Test thoroughly**
5. **Merge to develop**
6. **Repeat for next phase**

## Success Criteria

- [ ] Can add voice toggle in < 1 hour
- [ ] Know exactly where content gets modified
- [ ] Can add new user preference without touching 5 files
- [ ] New features don't require archaeology
- [ ] Tests still pass
- [ ] Bot still works

## Notes

- Each phase should be its own PR
- If a phase takes > 4 hours, it's too big - split it
- Don't refactor what's not painful
- Keep the old code working alongside new code initially
- Delete old code only after new code is proven

Remember: The goal isn't perfect architecture. It's making the code less painful to work with.
