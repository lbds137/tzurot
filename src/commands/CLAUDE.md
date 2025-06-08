# Command System Guidelines

This CLAUDE.md file provides specific guidance for working with the command system in Tzurot.

**📍 For complete documentation, see: [/docs/core/COMMAND_SYSTEM.md](/docs/core/COMMAND_SYSTEM.md)**

## Quick Developer Reference

### Command Handler Pattern

All command handlers should follow this structure:

```javascript
module.exports = {
  name: 'commandname', // Command name used in Discord
  description: 'What the command does',
  usage: '!tz commandname [options]', // Example usage
  permissions: ['ADMIN', 'USER'], // Who can use this command
  execute: async (message, args, context = {}) => {
    // Command implementation with dependency injection
  }
};
```

### File Organization

- `handlers/` - Individual command handlers (one file per command)
- `middleware/` - Shared middleware for auth, permissions, and deduplication
- `utils/` - Utility functions for command loading and registration

### Key Requirements

1. **Error Handling**: Always use try/catch with user-friendly error messages
2. **Logging**: Use the logger for all errors with context
3. **Dependency Injection**: Use context parameter for testability
4. **Permissions**: Specify required permissions properly
5. **Naming**: Use lowercase, descriptive names

### Quick Example

```javascript
const logger = require('../../logger');

module.exports = {
  name: 'example',
  description: 'Example command',
  usage: '!tz example [arg]',
  permissions: ['USER'],
  execute: async (message, args, context = {}) => {
    try {
      // Extract dependencies from context
      const { personalityManager = getPersonalityManager() } = context;
      
      // Validate arguments
      if (args.length < 1) {
        return await message.reply('Please provide an argument');
      }

      // Process the command
      const result = await personalityManager.doSomething(args[0]);
      
      // Return response
      return await message.reply(`Result: ${result}`);
    } catch (error) {
      logger.error(`Error in example command: ${error.message}`);
      return await message.reply('An error occurred while processing your command');
    }
  }
};
```

For complete documentation including user guides, architecture details, and testing patterns, see the [Command System Documentation](/docs/core/COMMAND_SYSTEM.md).