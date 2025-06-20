# DDD Command System Alias Routing Issue

## Problem Summary

The DDD command system has a wider issue with alias handling. Commands with aliases are not properly categorized in two critical locations, which affects feature flag routing.

## Affected Commands and Their Aliases

### Utility Commands
- **help**: aliases = ['h', '?']
- **notifications**: aliases = ['notif', 'notify']
- **purgbot**: aliases = ['purgebot', 'clearbot', 'cleandm']

### Conversation Commands
- **activate**: aliases = ['act']
- **deactivate**: aliases = ['deact']
- **autorespond**: aliases = ['ar', 'auto']

### Personality Commands
- **add**: aliases = ['create', 'new']
- **remove**: aliases = ['delete']

### Authentication Commands
- **verify**: aliases = ['nsfw']

## Root Cause

Two locations have hardcoded command lists that only include primary command names:

### 1. CommandIntegrationAdapter.js (lines 157-182)
```javascript
getCommandCategory(commandName) {
  const categoryMap = {
    personality: ['add', 'remove', 'info', 'alias', 'list'],
    conversation: ['reset', 'activate', 'deactivate', 'autorespond'],
    authentication: ['auth', 'verify'],
    utility: [
      'ping',
      'status',
      'debug',
      'purgbot',
      'volumetest',
      'notifications',
      'help',
      'backup',
    ],
  };
  // ... rest of function
}
```

### 2. HelpCommand.js (getCategoryForCommand function)
```javascript
// Personality management
if (['add', 'remove', 'list', 'alias', 'info'].includes(commandName)) {
  return 'Personality Management';
}

// Conversation
if (['activate', 'deactivate', 'reset', 'autorespond'].includes(commandName)) {
  return 'Conversation';
}

// Authentication
if (['auth', 'verify'].includes(commandName)) {
  return 'Authentication';
}
```

## Impact

When a user invokes a command using an alias:
1. The `resolveCommandName` method correctly finds the primary command name
2. But `getCommandCategory` is called with the ORIGINAL alias, not the resolved name
3. The alias doesn't exist in the hardcoded lists, so category lookup fails
4. Without a category, the feature flag check fails
5. The command defaults to the legacy system

## Solution

The fix needs to be applied in both locations:

1. **CommandIntegrationAdapter.js**: Update `shouldUseNewSystem` to use the resolved command name when calling `getCommandCategory`
2. **HelpCommand.js**: Update `getCategoryForCommand` to resolve aliases before checking categories

Additionally, consider creating a centralized command category mapping that both locations can use to avoid future synchronization issues.