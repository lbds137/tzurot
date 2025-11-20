# Command System Documentation

This document provides comprehensive documentation for the Tzurot bot command system, covering user commands, developer guidelines, and technical architecture.

The command system follows Domain-Driven Design principles with commands organized by business domain and routed through the application layer.

## Table of Contents

1. [User Guide](#user-guide)
   - [Command Reference](#command-reference)
   - [Permission Levels](#permission-levels)
   - [Interaction Methods](#interaction-methods)
2. [Developer Guide](#developer-guide)
   - [Command Structure](#command-structure)
   - [Creating New Commands](#creating-new-commands)
   - [Error Handling](#error-handling)
3. [Architecture](#architecture)
   - [Dependency Injection](#dependency-injection)
   - [Middleware System](#middleware-system)
   - [Context Parameters](#context-parameters)
4. [Testing](#testing)
   - [Testing Patterns](#testing-patterns)
   - [Migration Guide](#migration-guide)

---

## User Guide

### Command Prefix

All commands must be prefixed with `!tz` (configurable via environment variable `PREFIX`).

Example: `!tz help`, `!tz add personality-name`

### Command Reference

#### Personality Management

Commands for managing AI personalities in your personal collection.

##### `add` (alias: `create`)
Add a new AI personality to your collection.

**Syntax:** `!tz add <personality_name> [alias]`

**Parameters:**
- `personality_name` (required): The exact name of the personality on the AI service
- `alias` (optional): A nickname for easier reference

**Examples:**
```
!tz add lilith-tzel-shani
!tz add lilith-tzel-shani lilith
!tz create complex-personality-name cp
```

**Notes:**
- Personality names are case-sensitive
- Aliases are case-insensitive
- Each user maintains their own personality collection

---

##### `remove` (alias: `delete`)
Remove a personality from your collection.

**Syntax:** `!tz remove <personality_or_alias>`

**Examples:**
```
!tz remove lilith
!tz delete complex-personality-name
```

---

##### `list`
Display your added personalities with pagination support.

**Syntax:** `!tz list [page]`

**Examples:**
```
!tz list
!tz list 2
```

**Notes:**
- Shows 10 personalities per page
- Displays personality names, aliases, and avatar URLs

---

##### `alias`
Add an alias to an existing personality.

**Syntax:** `!tz alias <personality> <new_alias>`

**Examples:**
```
!tz alias lilith-tzel-shani lil
!tz alias complex-name cn
```

---

##### `info`
Display detailed information about a personality.

**Syntax:** `!tz info <personality_or_alias>`

**Examples:**
```
!tz info lilith
!tz info complex-personality-name
```

#### Conversation Control

##### `activate`
Activate a personality for the entire channel (moderator only).

**Syntax:** `!tz activate <personality_or_alias>`

**Required Permissions:** Manage Messages + NSFW Channel

**Examples:**
```
!tz activate lilith
!tz activate friendly-assistant
```

**Notes:**
- Channel-wide activation affects all users in the channel
- Only one personality can be active per channel
- Requires appropriate permissions

---

##### `deactivate`
Deactivate channel-wide personality.

**Syntax:** `!tz deactivate`

**Required Permissions:** Manage Messages

---

##### `reset`
Clear active conversation history.

**Syntax:** `!tz reset`

**Notes:**
- Clears your conversation state with the current personality
- Does not affect other users' conversations

---

##### `autorespond`
Toggle personal auto-response mode.

**Syntax:** `!tz autorespond [on|off]`

**Examples:**
```
!tz autorespond on
!tz autorespond off
!tz autorespond
```

#### Authentication

##### `auth`
Manage authentication status with the AI service.

**Syntax:** `!tz auth [token]`

**Examples:**
```
!tz auth
!tz auth your-api-token
```

**Notes:**
- Without token: Shows current authentication status
- With token: Sets authentication for AI service access
- Tokens are stored securely and not logged

---

##### `verify`
Verify your authentication status.

**Syntax:** `!tz verify`

#### System Commands

##### `help`
Display help information.

**Syntax:** `!tz help [command]`

**Examples:**
```
!tz help
!tz help add
!tz help activate
```

---

##### `ping`
Test bot responsiveness.

**Syntax:** `!tz ping`

---

##### `status`
Display bot status and statistics.

**Syntax:** `!tz status`

**Notes:**
- Shows uptime, memory usage, and system health
- Available to all users

---

##### `purgbot`
Purge bot messages from DM history.

**Syntax:** `!tz purgbot`

**Notes:**
- Only works in direct messages
- Removes bot messages to clean up conversation history

#### Administrator Commands

##### `debug`
Advanced debugging tools and system information.

**Syntax:** `!tz debug [subcommand]`

**Required Permissions:** Administrator

### Permission Levels

| Level | Description | Discord Permission |
|-------|-------------|-------------------|
| None | Available to all users | - |
| Manage Messages | Channel moderation | Manage Messages |
| Administrator | Bot administration | Administrator |

### Interaction Methods

#### Direct Commands
Standard command syntax: `!tz command arguments`

#### Mentions
Summon personalities by mentioning them:
- `@personality-name Hello!`
- `@alias How are you?`

#### Replies
Reply to personality messages to continue conversations:
- Reply to any message from a personality
- Maintains conversation context

#### Auto-Response
When enabled, personalities respond to all your messages in the channel.

---

## Developer Guide

### Command Structure

All command handlers follow this structure:

```javascript
module.exports = {
  name: 'commandname', // Command name used in Discord
  description: 'What the command does',
  usage: '!tz commandname [options]', // Example usage
  permissions: ['ADMIN', 'USER'], // Who can use this command
  execute: async (message, args, context) => {
    // Command implementation
  }
};
```

### Command Organization

Commands are organized as follows:

- `handlers/` - Individual command handlers (one file per command)
- `middleware/` - Shared middleware for auth, permissions, and deduplication
- `utils/` - Utility functions for command loading and registration

### Creating New Commands

1. **Create Handler File**
   ```javascript
   // handlers/newcommand.js
   const logger = require('../../logger');
   
   module.exports = {
     name: 'newcommand',
     description: 'Description of new command',
     usage: '!tz newcommand [arg]',
     permissions: ['USER'],
     execute: async (message, args, context = {}) => {
       try {
         // Validate arguments
         if (args.length < 1) {
           return await message.reply('Please provide an argument');
         }
   
         // Process the command
         const result = await doSomething(args[0]);
         
         // Return a response to Discord
         return await message.reply(`Result: ${result}`);
       } catch (error) {
         logger.error(`Error in newcommand: ${error.message}`);
         return await message.reply('An error occurred while processing your command');
       }
     }
   };
   ```

2. **Command Registration**
   Commands are automatically registered by the commandLoader system. New command handlers should:
   - Be placed in the `handlers/` directory
   - Export the required interface
   - Handle errors properly with try/catch
   - Follow naming conventions

### Command Naming Conventions

- Use lowercase letters only
- No spaces or special characters
- Keep names short and descriptive
- Prefer verbs for action commands (activate, remove, reset)
- Use nouns for information commands (info, list, status)

### Error Handling

All commands must have proper error handling:

1. Use try/catch in the execute function
2. Log errors with context using the logger
3. Provide user-friendly error messages
4. Never leave unhandled promises

### Middleware System

Commands use middleware for:

1. **Authentication** (`auth.js`) - Verifies user is authenticated if required
2. **Deduplication** (`deduplication.js`) - Prevents duplicate command processing
3. **Permissions** (`permissions.js`) - Enforces permission requirements

New commands should specify required permissions properly.

---

## Architecture

### Dependency Injection

The command system uses dependency injection to make commands testable and configurable.

#### Context Parameter

Commands receive a `context` object as their third parameter:

```javascript
execute: async (message, args, context = {}) => {
  const {
    personalityManager = getPersonalityManager(),
    conversationManager = getConversationManager(),
    aiService = getAIService(),
    scheduler = setTimeout,
    delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  } = context;
  
  // Use injected dependencies
  const personality = await personalityManager.getPersonality(name);
}
```

#### Benefits

1. **Testability**: Easy to inject mocks for testing
2. **Configuration**: Different environments can inject different implementations
3. **Flexibility**: Commands aren't tightly coupled to specific implementations

### Context Parameters

#### Standard Context Properties

| Property | Type | Description | Default |
|----------|------|-------------|---------|
| `personalityManager` | Object | Manages personality data | Production instance |
| `conversationManager` | Object | Manages conversation state | Production instance |
| `aiService` | Object | Handles AI API calls | Production instance |
| `scheduler` | Function | Timer scheduling | `setTimeout` |
| `delay` | Function | Async delays | Promise-wrapped setTimeout |

#### Usage Examples

```javascript
// Production usage (no context needed)
await command.execute(message, args);

// Testing usage
await command.execute(message, args, {
  personalityManager: mockPersonalityManager,
  scheduler: mockScheduler,
  delay: mockDelay
});

// Custom configuration
await command.execute(message, args, {
  aiService: customAIService,
  delay: fasterDelay
});
```

### Middleware System

Commands are processed through middleware layers:

```
Request → Auth → Permissions → Deduplication → Command → Response
```

#### Middleware Order

1. **Authentication**: Check if user is authenticated for AI service access
2. **Permissions**: Verify Discord permissions (Manage Messages, Administrator)
3. **Deduplication**: Prevent duplicate command processing
4. **Command Execution**: Run the actual command handler

---

## Testing

### Testing Patterns

#### Basic Command Test

```javascript
const command = require('../../src/commands/handlers/mycommand');

describe('Command: mycommand', () => {
  let mockMessage;
  let mockContext;
  
  beforeEach(() => {
    mockMessage = {
      reply: jest.fn().mockResolvedValue(undefined),
      author: { id: '123' }
    };
    
    mockContext = {
      personalityManager: {
        getPersonality: jest.fn()
      },
      scheduler: jest.fn(),
      delay: jest.fn().mockResolvedValue()
    };
  });

  it('should process valid arguments', async () => {
    mockContext.personalityManager.getPersonality.mockResolvedValue({
      name: 'test-personality'
    });

    await command.execute(mockMessage, ['test-arg'], mockContext);

    expect(mockMessage.reply).toHaveBeenCalledWith(
      expect.stringContaining('Success')
    );
  });

  it('should handle missing arguments', async () => {
    await command.execute(mockMessage, [], mockContext);

    expect(mockMessage.reply).toHaveBeenCalledWith(
      'Please provide an argument'
    );
  });
});
```

#### Testing with Dependency Injection

```javascript
it('should use injected dependencies', async () => {
  const mockDelay = jest.fn().mockResolvedValue();
  const mockScheduler = jest.fn();
  
  await command.execute(mockMessage, ['arg'], {
    delay: mockDelay,
    scheduler: mockScheduler
  });
  
  expect(mockDelay).toHaveBeenCalledWith(1000);
  expect(mockScheduler).toHaveBeenCalled();
});
```

### Migration Guide

#### Updating Commands to Use Context

1. **Add Context Parameter**
   ```javascript
   // Before
   execute: async (message, args) => {
   
   // After  
   execute: async (message, args, context = {}) => {
   ```

2. **Extract Dependencies**
   ```javascript
   // Before
   const personality = personalityManager.getPersonality(name);
   
   // After
   const { personalityManager = getPersonalityManager() } = context;
   const personality = await personalityManager.getPersonality(name);
   ```

3. **Update Tests**
   ```javascript
   // Before
   await command.execute(mockMessage, args);
   
   // After
   await command.execute(mockMessage, args, mockContext);
   ```

#### Testing Migration Checklist

- [ ] Add context parameter to execute function
- [ ] Extract all external dependencies from context
- [ ] Provide sensible defaults for production
- [ ] Update all tests to pass mock context
- [ ] Verify commands work without context (backward compatibility)

---

## Summary

The command system is designed for:
- **User-friendly**: Clear syntax and helpful error messages
- **Developer-friendly**: Consistent patterns and easy testing
- **Maintainable**: Dependency injection and middleware architecture
- **Extensible**: Easy to add new commands and middleware

For questions or issues, refer to the source code in `src/commands/` or create an issue in the project repository.