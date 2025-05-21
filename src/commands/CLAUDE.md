# Command System Guidelines

This CLAUDE.md file provides specific guidance for working with the command system in Tzurot.

## Command Structure

Commands are organized as follows:

- `handlers/` - Individual command handlers (one file per command)
- `middleware/` - Shared middleware for auth, permissions, and deduplication
- `utils/` - Utility functions for command loading and registration

## Command Handler Pattern

All command handlers should follow this structure:

```javascript
module.exports = {
  name: 'commandname', // Command name used in Discord
  description: 'What the command does',
  usage: '!tz commandname [options]', // Example usage
  permissions: ['ADMIN', 'USER'], // Who can use this command
  execute: async (message, args) => {
    // Command implementation
  }
};
```

## Command Registration

Commands are automatically registered by the commandLoader system. New command handlers should:

1. Be placed in the `handlers/` directory
2. Export the required interface (name, description, usage, permissions, execute)
3. Handle errors properly with try/catch

## Error Handling

IMPORTANT: All commands must have proper error handling:

1. Use try/catch in the execute function
2. Log errors with context using the logger
3. Provide user-friendly error messages
4. Never leave unhandled promises

## Example Command Implementation

```javascript
const logger = require('../../logger');

module.exports = {
  name: 'example',
  description: 'Example command',
  usage: '!tz example [arg]',
  permissions: ['USER'],
  execute: async (message, args) => {
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
      logger.error(`Error in example command: ${error.message}`);
      return await message.reply('An error occurred while processing your command');
    }
  }
};
```

## Middleware System

Commands use middleware for:

1. Authentication (`auth.js`) - Verifies user is authenticated if required
2. Deduplication (`deduplication.js`) - Prevents duplicate command processing
3. Permissions (`permissions.js`) - Enforces permission requirements

New commands should specify required permissions properly.