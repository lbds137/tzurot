# DDD Enablement Plan - Feature Parity Fixes

*Created: June 18, 2025*

## Overview

Based on the feature parity analysis, we've identified 3 critical gaps that must be fixed before enabling DDD in production. This document provides implementation plans for each fix.

## Critical Fixes Required

### 1. Implement Alias Reassignment

**Problem**: DDD throws an error when trying to assign an existing alias to a different personality. Legacy intelligently reassigns it.

**Implementation Plan**:

```javascript
// In PersonalityApplicationService.addAlias()
async addAlias(command) {
  const { personalityName, alias: aliasName, requesterId } = command;
  
  // Find the personality
  const personality = await this.personalityRepository.findByName(personalityName);
  if (!personality) {
    throw new Error(`Personality "${personalityName}" not found`);
  }
  
  // Verify ownership
  if (personality.ownerId.toString() !== requesterId) {
    throw new Error('Only the owner can add aliases');
  }
  
  // Check if alias is already in use
  const existingPersonality = await this.personalityRepository.findByAlias(aliasName);
  if (existingPersonality) {
    // NEW: Check if it's the same personality (no-op)
    if (existingPersonality.id.equals(personality.id)) {
      logger.info(`Alias ${aliasName} already points to ${personalityName} - no changes needed`);
      return { success: true, personality };
    }
    
    // NEW: Check if user owns the existing personality
    if (existingPersonality.ownerId.toString() === requesterId) {
      // Remove alias from old personality
      existingPersonality.removeAlias(aliasName);
      await this.personalityRepository.save(existingPersonality);
      logger.info(`Alias ${aliasName} reassigned from ${existingPersonality.profile.name} to ${personalityName}`);
    } else {
      // Can't reassign alias owned by another user
      throw new Error(`Alias "${aliasName}" is already in use by another user's personality`);
    }
  }
  
  // Add the alias
  const alias = new Alias(aliasName);
  personality.addAlias(alias);
  await this.personalityRepository.save(personality);
  
  return { success: true, personality };
}
```

**Testing Required**:
- Test alias reassignment between personalities
- Test no-op when alias already points to same personality
- Test error when trying to steal another user's alias
- Verify domain events are published correctly

### 2. Add Alias Support to Add Command

**Problem**: Legacy supports `add <name> [alias]`, DDD doesn't.

**Implementation Plan**:

```javascript
// In AddCommand.js
// Update command options to include alias
options: [
  new CommandOption({
    name: 'name',
    description: 'The name of the personality',
    type: 'string',
    required: true,
  }),
  new CommandOption({
    name: 'alias',
    description: 'Optional alias for the personality',
    type: 'string',
    required: false,
  }),
  // ... existing options
],

// In execute function
let name, alias, prompt, modelPath, maxWordCount;

if (context.isSlashCommand) {
  name = context.options.name;
  alias = context.options.alias; // NEW
  prompt = context.options.prompt;
  modelPath = context.options.model;
  maxWordCount = context.options.maxwords;
} else {
  // Text command parsing
  name = context.args[0];
  
  // NEW: Check if second arg is alias or start of prompt
  if (context.args.length > 1) {
    const secondArg = context.args[1];
    
    // If it looks like a prompt (contains spaces or quotes), treat as prompt
    if (context.args.length === 2 && !secondArg.includes(' ') && 
        !secondArg.startsWith('"') && !secondArg.startsWith("'")) {
      alias = secondArg;
      prompt = context.args.slice(2).join(' ');
    } else {
      prompt = context.args.slice(1).join(' ');
    }
  }
}

// After personality creation
const personality = await personalityService.registerPersonality(command);

// NEW: Add alias if provided
if (alias) {
  try {
    await personalityService.addAlias({
      personalityName: name,
      alias: alias,
      requesterId: context.getUserId()
    });
    logger.info(`[AddCommand] Added alias "${alias}" to personality "${name}"`);
  } catch (error) {
    logger.warn(`[AddCommand] Failed to add alias: ${error.message}`);
    // Don't fail the whole command, just warn about alias
  }
}
```

**Testing Required**:
- Test `add PersonalityName alias`
- Test `add PersonalityName alias "prompt with spaces"`
- Test `add PersonalityName "prompt without alias"`
- Verify alias is added after personality creation

### 3. Implement Request Deduplication

**Problem**: Legacy prevents duplicate add requests within 5 seconds. DDD lacks this protection.

**Implementation Plan**:

```javascript
// Create RequestDeduplicator service
class RequestDeduplicator {
  constructor(cooldownMs = 5000) {
    this.pendingRequests = new Map();
    this.cooldownMs = cooldownMs;
  }
  
  isDuplicate(key, timestamp = Date.now()) {
    const existing = this.pendingRequests.get(key);
    if (!existing) return false;
    
    // Check if within cooldown period
    return timestamp - existing.timestamp < this.cooldownMs;
  }
  
  trackRequest(key, timestamp = Date.now()) {
    this.pendingRequests.set(key, { timestamp });
    
    // Auto-cleanup after cooldown
    setTimeout(() => {
      this.pendingRequests.delete(key);
    }, this.cooldownMs);
  }
}

// In AddCommand.js
const deduplicator = context.dependencies.requestDeduplicator || new RequestDeduplicator();

// Early in execute function
const dedupeKey = `${context.getUserId()}-${name}`;
if (deduplicator.isDuplicate(dedupeKey)) {
  logger.warn(`[AddCommand] Duplicate request detected for ${dedupeKey}`);
  return await context.respond(
    'This personality was just added. Please wait a moment before trying again.'
  );
}

// Track the request
deduplicator.trackRequest(dedupeKey);

// Continue with personality creation...
```

**Testing Required**:
- Test rapid duplicate requests are blocked
- Test requests after cooldown period are allowed
- Test deduplication key includes user ID (different users can add same name)
- Verify memory cleanup after cooldown

## Implementation Order

1. **Alias Reassignment** (High Priority)
   - Most user-visible issue
   - Required for user satisfaction
   - Estimated: 2-4 hours

2. **Add Command Alias** (Medium Priority)
   - Quality of life improvement
   - Backward compatibility
   - Estimated: 1-2 hours

3. **Request Deduplication** (Low Priority)
   - Prevents edge case issues
   - Not user-visible normally
   - Estimated: 1-2 hours

## Testing Strategy

### Unit Tests
- Test each fix in isolation
- Mock dependencies appropriately
- Cover edge cases

### Integration Tests
- Test full command flow with fixes
- Verify database state after operations
- Check event publishing

### Manual Testing Checklist
- [ ] Can reassign alias between personalities
- [ ] Can add personality with alias in one command
- [ ] Duplicate requests are blocked appropriately
- [ ] All existing functionality still works
- [ ] Performance is acceptable

## Rollback Plan

If issues are discovered after deployment:

1. **Feature Flag Disable** - Immediate rollback via flags
2. **Code Revert** - If flags insufficient, revert commits
3. **Data Cleanup** - Scripts to fix any data inconsistencies

## Success Criteria

- [ ] All legacy functionality is preserved
- [ ] No performance regression > 10%
- [ ] All tests pass with > 95% coverage
- [ ] Manual testing confirms parity
- [ ] Zero user-facing errors in staging

## Next Steps

1. Implement fixes in feature branch
2. Write comprehensive tests
3. Deploy to staging environment
4. Conduct thorough testing
5. Create PR for review
6. Deploy with careful monitoring

Once these fixes are implemented and tested, we can proceed with confidence to enable DDD in production.