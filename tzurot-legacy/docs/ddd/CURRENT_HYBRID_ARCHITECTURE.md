# Current Hybrid Architecture

## Overview

Tzurot operates with a hybrid architecture where ~25% uses Domain-Driven Design patterns and ~75% remains legacy. This document explains how the two systems coexist.

## Architecture Diagram

```
Discord Message
      ↓
   bot.js (Legacy)
      ↓
   Is it a command? ─────→ YES ─→ CommandIntegrationAdapter ─→ DDD Commands
      ↓ NO                              ↓
   personalityHandler.js               Uses DDD Services:
   (Legacy)                            - AuthenticationApplicationService
      ↓                                - PersonalityApplicationService
   aiService.js (Legacy)               - FeatureFlags
      ↓                                - EventBus
   webhookManager.js
   (Legacy)
```

## The Two Systems

### DDD System (25%)

**Location**: `src/domain/`, `src/application/`, `src/adapters/`

**Components**:

- All 18 commands (add, remove, info, list, etc.)
- Authentication domain (tokens, blacklist, verification)
- Personality domain (used by commands only)
- Event bus and domain events
- File-based repositories

**Entry Points**:

- `CommandIntegrationAdapter` - Bridge from legacy to DDD
- `ApplicationBootstrap` - Dependency injection container

### Legacy System (75%)

**Location**: `src/`, `src/core/`, `src/handlers/`

**Components**:

- Message routing (`bot.js`)
- AI request handling (`aiService.js`)
- Webhook management (`webhookManager.js`)
- Conversation tracking (`conversationManager.js`)
- Personality message flow (`personalityHandler.js`)

**Entry Points**:

- `bot.js` - Main Discord client
- `index.js` - Application startup

## Integration Points

### 1. Command Processing

```javascript
// In bot.js (legacy)
if (message.content.startsWith(commandPrefix)) {
  // Routes to CommandIntegrationAdapter (bridge)
  const adapter = getCommandIntegrationAdapter();
  await adapter.handleCommand(message);
}
```

### 2. Authentication Checks

```javascript
// In personalityHandler.js (legacy)
const authService = applicationBootstrap.getServices().authenticationService;
const result = await authService.checkPersonalityAccess(userId, personality);
```

### 3. Personality Lookups

```javascript
// In commands (DDD)
const personality = await personalityService.getPersonality(name);

// In message handlers (legacy)
const personality = personalityManager.getPersonality(name);
```

## Data Flow Examples

### Command Flow (DDD)

1. User types: `!tz add Claude "You are Claude"`
2. `bot.js` detects command prefix
3. Routes to `CommandIntegrationAdapter`
4. Adapter creates `CommandContext`
5. Routes to `AddCommand` (DDD)
6. Uses `PersonalityApplicationService`
7. Saves via `FilePersonalityRepository`
8. Emits domain events

### Message Flow (Legacy)

1. User types: `@Claude hello`
2. `bot.js` detects mention
3. Routes to `personalityHandler.js`
4. Checks auth via DDD `AuthenticationApplicationService`
5. Gets personality from legacy `personalityManager`
6. Calls legacy `aiService.js`
7. Sends via legacy `webhookManager.js`

## Shared Resources

### File System

Both systems read/write the same files:

- `data/personalities.json` - Personality data
- `data/blacklist.json` - Blacklist data
- `data/tokens.json` - User tokens
- `data/conversations.json` - Conversation data

### Services Used by Both

- `logger` - Shared logging
- `config` - Configuration values
- Discord client - Same bot instance

## Key Differences

### Error Handling

- **DDD**: Throws domain exceptions, caught at boundaries
- **Legacy**: Returns error objects, logs directly

### Async Patterns

- **DDD**: Async/await throughout
- **Legacy**: Mix of callbacks, promises, async/await

### Dependency Management

- **DDD**: Constructor injection via ApplicationBootstrap
- **Legacy**: Direct requires, some singletons

### Testing

- **DDD**: Full dependency injection, easy mocking
- **Legacy**: Some modules hard to test

## Working with the Hybrid

### Adding New Features

**If it's a command**: Use DDD patterns

```javascript
// Create in src/application/commands/
class MyCommand extends Command {
  // Implementation
}
```

**If it's message processing**: Use legacy patterns

```javascript
// Modify in src/handlers/ or src/
// Follow existing patterns
```

### Modifying Existing Features

**Commands or Auth**: Modify DDD code

- Look in `src/application/commands/`
- Or `src/domain/authentication/`

**AI, Webhooks, Conversations**: Modify legacy code

- `src/aiService.js`
- `src/webhookManager.js`
- `src/core/conversation/`

### Common Pitfalls

1. **Don't mix patterns** - Use DDD or legacy, not both
2. **Watch for circular dependencies** - ApplicationBootstrap is injected, not imported
3. **Respect boundaries** - Don't import legacy into domain layer
4. **Keep data compatible** - Both systems share files

## Future Considerations

### Option 1: Complete Migration

Would need to migrate:

- AI service (3 weeks)
- Message handlers (4 weeks)
- Conversation system (4 weeks)
- Webhook system (2 weeks)

### Option 2: Maintain Hybrid

- Document patterns clearly
- Improve integration points
- Build new features appropriately
- Accept the split architecture

### Option 3: Gradual Migration

- Migrate when touching code
- Could take years
- Risk of more inconsistency

## Conclusion

The hybrid architecture works but requires understanding both systems. New commands should use DDD, core bot logic remains legacy. Both are production code requiring maintenance.
