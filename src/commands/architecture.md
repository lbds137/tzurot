# Command System Architecture

## Overview
This architecture splits the monolithic `commands.js` file into smaller, more maintainable modules that follow the Single Responsibility Principle.

## Directory Structure

```
src/
├── commands/
│   ├── index.js                  # Main entry point, exports processCommand and command handlers
│   ├── utils/                    # Command-specific utilities
│   │   ├── commandRegistry.js    # Registry for registering and retrieving commands
│   │   ├── messageTracker.js     # Track processed messages to prevent duplicates
│   │   ├── commandValidator.js   # Validate command permissions and inputs
│   │   └── embedBuilders.js      # Utility functions for building embeds
│   ├── handlers/                 # Command handler implementation files
│   │   ├── help.js               # Help command implementation
│   │   ├── add.js                # Add personality command
│   │   ├── list.js               # List personalities command
│   │   ├── alias.js              # Alias management command
│   │   ├── remove.js             # Remove personality command
│   │   ├── reset.js              # Reset conversation command
│   │   ├── info.js               # Personality info command
│   │   ├── auth.js               # Authentication commands
│   │   ├── ping.js               # Ping command
│   │   ├── debug.js              # Debug commands (admin-only)
│   │   ├── verify.js             # Age verification command
│   │   ├── status.js             # Bot status command
│   │   ├── activate.js           # Activate personality in channel
│   │   ├── deactivate.js         # Deactivate personality in channel
│   │   ├── autorespond.js        # Auto-response settings
│   │   └── clearerrors.js        # Clear error state command
│   └── middleware/               # Command processing middleware
│       ├── auth.js               # Authentication middleware
│       ├── deduplication.js      # Deduplication middleware
│       └── permissions.js        # Permission check middleware
```

## Command Registration System

The new system will use a simple registry pattern:

1. Each command handler is a module that exports:
   - `meta`: Command metadata (name, aliases, description, usage, permissions)
   - `execute`: The function that handles the command

2. The command registry will:
   - Load all command handlers
   - Register them with their metadata
   - Provide lookup by command name and alias

## Command Processing Flow

1. User enters a command
2. `processCommand` in `index.js` receives the command
3. Command passes through middleware:
   - Deduplication (prevent duplicate commands)
   - Authentication (check if user is authorized)
   - Permissions (check if user has permission)
4. Registry looks up the appropriate handler
5. Handler executes the command with clean inputs
6. Response is sent back to the user

## Benefits

- **Maintainability**: Each command is in its own file
- **Testability**: Isolated command handlers are easier to test
- **Extendibility**: New commands can be added without modifying existing code
- **Readability**: Smaller, focused modules are easier to understand
- **Reliability**: Command-specific bugs are isolated to their modules

## Implementation Strategy

1. Create the directory structure
2. Implement the command registry
3. Implement core middleware
4. Move each command handler to its own file
5. Update the main entry point to use the new system
6. Update tests to work with the new structure