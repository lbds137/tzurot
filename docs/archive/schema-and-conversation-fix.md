# Schema Redesign + Conversation History Bug Fix

## Issues to Fix

### Issue 1: Schema Circular Dependencies
- User.globalPersonaId → Persona.id
- Persona.ownerId → User.id
- Makes data import/export difficult
- Unclear ownership model

### Issue 2: Conversation History Bug (CRITICAL)
**Symptom**: Multiple users in same channel treated as same person by AI

**Root Cause**: `ConversationHistoryService.getRecentHistory()` doesn't filter by userId:
```typescript
// Current (WRONG):
async getRecentHistory(channelId: string, personalityId: string, limit: number)
// Returns mixed conversation from ALL users in channel

// Should be:
async getRecentHistory(channelId: string, personalityId: string, userId: string, limit: number)
// Returns only THIS user's conversation
```

## Fix Strategy

### Phase 1: Fix Conversation History (Quick Fix)

**Priority**: HIGH - this is actively causing bugs

**Changes needed**:
1. Add `userId` parameter to `getRecentHistory()`
2. Filter conversation history by userId
3. Update all callers to pass userId
4. Add index on `[channelId, personalityId, userId, createdAt]`

**Files to change**:
- `packages/common-types/src/services/ConversationHistoryService.ts`
- `services/ai-worker/src/services/ConversationService.ts` (or wherever it's called)
- Any other callers

**Test**:
- User A and User B both talk to same personality in same channel
- Each should get responses based only on THEIR conversation
- No cross-contamination

### Phase 2: Schema Redesign (Technical Debt Fix)

**Priority**: MEDIUM - design improvement, not causing bugs

**Changes needed** (from schema-redesign-proposal.md):
1. Create `UserDefaultPersona` table
2. Create `PersonalityDefaultConfig` table
3. Rename `UserPersonalitySettings` → `UserPersonalityConfig`
4. Add `ownerId` to `LlmConfig`
5. Make `Persona.ownerId` NOT NULL
6. Remove `User.globalPersonaId`
7. Remove `Personality.llmConfigId`
8. Remove `Persona.isGlobal`

**Migration steps**:
1. Create new tables
2. Copy data from old columns to new tables
3. Drop old columns
4. Update application code

## Recommendation

**Do Phase 1 first** (conversation history fix):
- It's the actual bug users are experiencing
- Quick fix (< 30 minutes)
- Can deploy immediately
- Doesn't require data migration

**Then do Phase 2** (schema redesign):
- Not urgent (no user-facing bugs)
- Larger change (needs careful migration)
- Can take our time to get it right

## Decision Points

1. **Should we do both now?**
   - Pro: Fix everything at once
   - Con: More complex, delays production deployment

2. **Should we do Phase 1 only now?**
   - Pro: Fix the actual bug quickly, deploy to production
   - Con: Schema issues remain (but not causing bugs)

3. **Should we do conversation history per-user or per-channel?**
   - Current: Per-channel (all users mixed) ❌
   - Option A: Per-user (separate thread per user) ✅
   - Option B: Hybrid (show all users, but label who said what)

   **Recommended**: Option A - separate threads per user. Each user has their own conversation with the personality, including their own persona context.

## Implementation Plan (if doing both)

1. Fix conversation history bug (Phase 1)
2. Test in development
3. Apply schema redesign (Phase 2)
4. Migrate development data
5. Test thoroughly
6. Replicate to production (with new schema)
7. Deploy to production

## Implementation Plan (if doing Phase 1 only)

1. Fix conversation history bug
2. Test in development
3. Deploy to production
4. Schedule Phase 2 for later

---

**Your call**: Which approach do you want to take?
