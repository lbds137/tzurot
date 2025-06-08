# Personality System Refactoring Proposal

**Created**: June 2, 2025  
**Status**: Proposed  
**Priority**: High

## Current Issues

The current personality system has several confusing aspects:

1. **Unclear User vs Global Distinction**: The system attempts to separate user-specific personalities from global ones, but the implementation is inconsistent:
   - Sometimes `null` is passed to check global personalities
   - Sometimes the user ID is passed but with fallback logic
   - Different parts of the codebase handle this differently

2. **Inconsistent Lookup Logic**: 
   - `messageHandler.js` line 437: `getPersonalityByAlias(message.author.id, mentionText)` - passes user ID
   - `referenceHandler.js` line 106: Was calling without user ID (just fixed)
   - Some places check user-specific first, then global; others don't

3. **Data Structure Confusion**: The current `personalities.json` structure doesn't clearly represent the relationship between global and user-specific personalities.

## Proposed Solution

### 1. Clear Data Structure

```json
{
  "globalPersonalities": {
    "personality-unique-id": {
      "fullName": "personality-unique-id",
      "displayName": "Personality Name",
      "addedBy": "user-id-who-added",
      "addedAt": "2024-01-01T00:00:00Z",
      "globalAliases": [
        "personality name",      // Auto-generated from display name (always global)
        "personality name 2"     // Auto-generated collision resolution (always global)
      ],
      "userAliases": {
        "custom alias": ["user-id-1", "user-id-2"],  // Custom user-added aliases
        "angel dust": ["user-id-1"]                  // User-specific custom alias
      }
    }
  },
  "userPersonalities": {
    "user-id-1": ["personality-unique-id-1", "personality-unique-id-2"],
    "user-id-2": ["personality-unique-id-3"]
  }
}
```

### Key Design Decisions:

1. **Global Aliases**: Auto-generated aliases from display names are always global
   - When adding a personality, the display name becomes a global alias
   - If there's a collision, the modified version (e.g., "name 2") is also global
   - This ensures basic personality names are accessible to everyone

2. **User Aliases**: Only custom aliases added via `!tz alias` command are user-specific
   - Users can add their own shortcuts/nicknames for personalities
   - These remain private to the user who created them

### 2. Unified Lookup Service

Create a new `PersonalityLookupService` that encapsulates all lookup logic:

```javascript
class PersonalityLookupService {
  /**
   * Lookup a personality by name or alias
   * @param {string} nameOrAlias - The personality name or alias to lookup
   * @param {string|null} userId - The user ID for user-specific lookups (null for global only)
   * @returns {Object|null} The personality object or null if not found
   */
  lookupPersonality(nameOrAlias, userId = null) {
    const normalizedLookup = nameOrAlias.toLowerCase();
    
    // 1. Check if it's a direct personality name (always global)
    const directMatch = this.globalPersonalities[nameOrAlias];
    if (directMatch) return directMatch;
    
    // 2. Check global aliases (display names and auto-generated)
    for (const [id, personality] of Object.entries(this.globalPersonalities)) {
      if (personality.globalAliases.includes(normalizedLookup)) {
        return personality;
      }
    }
    
    // 3. If userId provided, check user-specific custom aliases
    if (userId) {
      for (const [id, personality] of Object.entries(this.globalPersonalities)) {
        const userAliases = personality.userAliases[normalizedLookup];
        if (userAliases && userAliases.includes(userId)) {
          return personality;
        }
      }
    }
    
    return null;
  }
}
```

### 3. Migration Plan

1. **Phase 1**: Create the new service alongside existing system
   - Implement `PersonalityLookupService`
   - Add migration utilities to convert existing data
   - Add comprehensive tests

2. **Phase 2**: Gradual replacement
   - Replace all `getPersonality()` calls with `lookupService.lookupPersonality()`
   - Replace all `getPersonalityByAlias()` calls
   - Ensure backward compatibility

3. **Phase 3**: Data migration
   - Convert existing personalities.json to new format
   - Update persistence layer
   - Remove old lookup functions

### 4. Benefits

1. **Consistency**: Single source of truth for personality lookups
2. **Clarity**: Clear distinction between global and user-specific aliases
3. **Simplicity**: Auto-generated aliases are always global - no confusion
4. **Flexibility**: Easy to add new features like:
   - Personality sharing between users
   - Permission levels
   - Alias management per user

### 5. Alias Management Rules

1. **Automatic Global Aliases** (created when personality is added):
   - Display name → global alias (e.g., "Angel Dust" → "angel dust")
   - Collision resolution → global alias (e.g., "angel dust 2")
   - These are accessible by ALL users immediately

2. **Custom User Aliases** (created via `!tz alias` command):
   - User-specific shortcuts (e.g., "ad" → "angel dust")
   - Private to the creating user
   - Can override global aliases for that user

### 6. Example Usage

```javascript
// In messageHandler.js
const personality = lookupService.lookupPersonality(mentionText, message.author.id);

// In referenceHandler.js  
const personality = lookupService.lookupPersonality(personalityName, message.author.id);

// For admin commands (global lookup)
const personality = lookupService.lookupPersonality(name, null, false);
```

## Implementation Checklist

- [ ] Design and implement `PersonalityLookupService`
- [ ] Create comprehensive tests for the service
- [ ] Add data migration utilities
- [ ] Update all personality lookup calls
- [ ] Migrate existing data to new format
- [ ] Update documentation
- [ ] Remove deprecated functions

## Estimated Effort

- Initial implementation: 2-3 days
- Testing and migration: 2-3 days
- Full rollout: 1-2 weeks

## Related Files to Update

- `src/personalityManager.js` - Core changes
- `src/handlers/messageHandler.js` - Update lookup calls
- `src/handlers/referenceHandler.js` - Update lookup calls
- `src/commands/handlers/add.js` - Update personality creation
- `src/commands/handlers/alias.js` - Update alias management
- `data/personalities.json` - Migrate data structure