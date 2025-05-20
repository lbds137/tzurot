# Command System Documentation

## Overview

The command system in Tzurot has been refactored to follow a modular, maintainable architecture. This document provides an overview of the new system and explains how to add new commands.

## Architecture

The new command system uses a modular architecture with the following components:

- **Command Registry**: Centralized registry for registering and retrieving commands
- **Command Handlers**: Individual modules for each command
- **Middleware**: Cross-cutting concerns like authentication and permissions
- **Message Tracking**: Utilities for preventing duplicate command execution

### Directory Structure

```
src/
├── commands/
│   ├── index.js                  # Main entry point
│   ├── utils/                    # Command-specific utilities
│   │   ├── commandRegistry.js    # Registry for commands
│   │   ├── messageTracker.js     # Track processed messages
│   │   └── commandValidator.js   # Validate permissions
│   ├── handlers/                 # Command handlers
│   │   ├── help.js               # Help command
│   │   ├── add.js                # Add personality command
│   │   └── ...                   # Other command handlers
│   └── middleware/               # Command middleware
│       ├── auth.js               # Authentication middleware
│       ├── deduplication.js      # Deduplication middleware
│       └── permissions.js        # Permission check middleware
```

## Adding a New Command

To add a new command, follow these steps:

1. **Create a new handler file** in the `src/commands/handlers/` directory
2. **Implement the command module** with the required structure
3. **Register the command** in `src/commands/index.js`

### Command Module Structure

Each command module should export an object with the following structure:

```javascript
/**
 * Command metadata
 */
const meta = {
  name: 'commandname',              // Command name (required)
  description: 'Command description', // Short description
  usage: 'commandname <arg1> [arg2]', // Usage pattern
  aliases: ['alias1', 'alias2'],    // Command aliases (optional)
  permissions: []                   // Required permissions (optional)
};

/**
 * Execute the command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Command implementation
}

module.exports = {
  meta,
  execute
};
```

### Available Permissions

The following permissions can be specified in the `permissions` array:

- `ADMINISTRATOR`: Requires Discord Administrator permission
- `MANAGE_MESSAGES`: Requires Manage Messages permission
- `NSFW_CHANNEL`: Requires the command to be run in an NSFW channel

### Command Registration

In `src/commands/index.js`, import and register your command:

```javascript
// Import your command
const yourCommand = require('./handlers/yourCommand');

// Register it with the registry
commandRegistry.register(yourCommand);
```

## Command Processing Flow

1. User enters a command in Discord
2. Bot parses command and arguments
3. Command is passed to the command system via `processCommand`
4. Deduplication middleware checks if the command is a duplicate
5. Authentication middleware checks if the user is authenticated
6. Command registry looks up the command handler
7. Permissions middleware checks if the user has required permissions
8. Command handler executes the command
9. Response is sent back to the user

## Testing

Each command should have corresponding tests in the `tests/unit/commands/handlers/` directory following the standardized approach described in `docs/COMMAND_TEST_STANDARDIZATION.md`.

The test file should:

1. Mock required dependencies
2. Test the command's metadata
3. Test the command's execution under various conditions 
4. Test error handling

Example test structure:

```javascript
/**
 * Tests for the command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
// ...

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mock dependencies 
const logger = require('../../../../src/logger');
// ...

describe('Command Name', () => {
  let commandHandler;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup mock objects
    mockMessage = helpers.createMockMessage();
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Mock needed functions
    // ...
    
    // Import the command after setting up mocks
    commandHandler = require('../../../../src/commands/handlers/commandName');
  });
  
  it('should have the correct metadata', () => {
    // Test the command's meta object
  });
  
  it('should handle valid input', async () => {
    // Test successful command execution
  });
  
  it('should handle errors gracefully', async () => {
    // Test error handling
  });
});
```

For standardized testing utilities, see the `commandTestHelpers.js` module which provides helper functions to create mock messages, validators, and verify responses.

## Migration Strategy

During the migration period, we use a command loader bridge (`src/commandLoader.js`) that:

1. Checks if a command exists in the new system
2. If yes, processes it with the new system
3. If no, falls back to the old command system

This allows for a gradual migration without breaking existing functionality.

## Best Practices

1. **Single Responsibility**: Each command handler should focus on one command
2. **Error Handling**: Always handle errors gracefully
3. **Logging**: Use the logger for important events
4. **Validation**: Validate user input before processing
5. **Permissions**: Always check permissions for commands that require them
6. **Documentation**: Document command metadata, parameters, and behavior
7. **Testing**: Write comprehensive tests for each command