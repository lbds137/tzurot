# Command Test Standardization

## Overview

This document outlines the standardized approach to testing command handlers in the Tzurot codebase. The goal of this standardization is to ensure all command tests follow a consistent pattern, which improves maintainability and test coverage.

## Directory Structure

All command tests should be organized in the following directory structure:

```
tests/
└── unit/
    └── commands/
        ├── handlers/          # Tests for individual command handlers
        │   ├── auth.test.js
        │   ├── add.test.js
        │   └── ...
        ├── middleware/        # Tests for command middleware
        │   ├── auth.test.js
        │   └── ...
        └── utils/             # Tests for command utilities
            ├── commandRegistry.test.js
            ├── commandLoader.test.js
            └── ...
```

## Test File Structure

Each command test file should follow this structure:

```javascript
/**
 * Tests for the [command name] command handler
 */

// Mock dependencies first
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  // Configuration mock
}));

// Other specific mocks for this command
jest.mock('../../../../src/path/to/dependency', () => ({
  // Dependency mock
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked dependencies
const logger = require('../../../../src/logger');
const dependency = require('../../../../src/path/to/dependency');

describe('Command Name', () => {
  let commandHandler;
  let mockMessage;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock message and other test objects
    mockMessage = helpers.createMockMessage();
    
    // Configure default mock behaviors
    
    // Import command after mock setup
    commandHandler = require('../../../../src/commands/handlers/commandName');
  });
  
  // Test command metadata
  it('should have the correct metadata', () => {
    expect(commandHandler.meta).toEqual({
      name: 'commandname',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  // Test basic functionality
  it('should handle basic usage correctly', async () => {
    await commandHandler.execute(mockMessage, []);
    
    // Assertions
  });
  
  // Test sub-commands or variations (if applicable)
  describe('specific subcommand', () => {
    it('should handle subcommand correctly', async () => {
      // Test code
    });
  });
  
  // Test error handling
  it('should handle errors gracefully', async () => {
    // Configure error condition
    
    await commandHandler.execute(mockMessage, []);
    
    // Assertions for error handling
  });
});
```

## Testing Standards

1. **Isolation**: Each test should be independent and not rely on the state of other tests.
2. **Complete Mocking**: All external dependencies should be mocked.
3. **Reset Mocks**: Clear mocks in `beforeEach` to ensure a clean state for each test.
4. **Test Structure**: Follow the structure of testing metadata, basic functionality, specific scenarios, and error handling.
5. **Consistent Assertions**: Use consistent patterns for assertions.
6. **Message Mock**: Use the `createMockMessage` helper to create standardized message mocks.
7. **Explicit Expectations**: Each test should have explicit expectations rather than just verifying that code runs.

## Command Test Helpers

The `commandTestHelpers.js` module provides several utilities for testing commands:

```javascript
// Create a mock message
const mockMessage = helpers.createMockMessage({
  isDM: false,            // Set to true for DM channel
  isAdmin: false,         // Set to true for admin permissions
  canManageMessages: false, // Set to true for manage message permissions
  isNSFW: false           // Set to true for NSFW channel
});

// Create a validator mock
const validatorMock = helpers.mockValidator({
  isAdmin: false,
  canManageMessages: false,
  isNsfwChannel: false
});

// Verify response
helpers.verifySuccessResponse(mockDirectSend, {
  isEmbed: true,          // Check if response is an embed
  title: 'Expected Title', // Check embed title
  contains: 'expected text' // Check content contains text
});

// Verify error
helpers.verifyErrorResponse(mockDirectSend, {
  contains: 'error text'   // Check error message contains text
});
```

## Consolidated Tests

To maintain a clean test suite, we've consolidated multiple test files for the same command into a single file under the `handlers/` directory. For example:

- ❌ `tests/unit/commands.auth.test.js` (old location)
- ❌ `tests/unit/commands/auth.test.js` (transitional location)
- ✅ `tests/unit/commands/handlers/auth.test.js` (new standardized location)

This consolidation ensures:
1. Better test organization
2. Elimination of duplicate test coverage
3. Standardized testing approach
4. Easier maintenance

## Special Cases: CommandLoader

For modules that interact with Node.js's module system (like the CommandLoader modules), we use a simplified testing approach:

1. **Minimal API Testing**: Only test the API structure and minimal functionality
2. **Documentation-Based Testing**: Document what should be manually verified
3. **Accept Lower Coverage**: Some modules are difficult to test fully due to their architecture

See `/docs/COMMANDLOADER_TEST_APPROACH.md` for details about this special case.

## Migration Strategy

When migrating existing tests to the new standard:

1. Create a new test file in the appropriate directory
2. Analyze existing tests to understand coverage requirements
3. Implement tests using the new structure and helpers
4. Verify test coverage is maintained or improved
5. Remove old test files once migration is complete

## Test Coverage Requirements

Each command test should verify:

1. Command metadata is correct
2. Basic command execution works properly
3. All subcommands or variations are tested
4. Input validation is working
5. Error handling is robust
6. Permissions are properly enforced (if applicable)
7. Special conditions are handled (webhooks, DMs, etc.)

## Recently Standardized Command Tests

The following command tests have been standardized to follow the consistent pattern described in this document:

1. **List Command Test** (`tests/unit/commands/handlers/list.test.js`)
   - Follows standardized format with proper mock setup and test organization
   - Achieves 100% line coverage for list.js
   - Tests all edge cases including pagination, errors, and empty results

2. **Reset Command Test** (`tests/unit/commands/reset.test.js`)
   - Updated to use standardized pattern with organized mock setup
   - Achieves 100% line coverage for reset.js
   - Tests alias resolution, error handling, and invalid inputs

3. **Status Command Test** (`tests/unit/commands/status.test.js`)
   - Updated to follow standardized format with organization and clean mocks
   - Achieves 97.61% statement coverage and 100% function coverage
   - Tests authenticated/unauthenticated user states and error handling

4. **Verify Command Test** (`tests/unit/commands/verify.test.js`)
   - Standardized to follow consistent format with clear mock setup
   - Achieves 91.66% statement coverage and 94.28% line coverage
   - Tests various verification scenarios including DM channels, NSFW access, and errors

### Standardization Challenges

During standardization, we encountered several challenges:

1. **AddFields Method Testing**: 
   - The Discord.js EmbedBuilder.addFields method can be called with multiple parameters or separately
   - Solution: Updated test assertions to check for specific field patterns rather than exact call counts

2. **Path References**: 
   - Path references in tests needed to be updated to match the new command structure
   - Solution: Updated all imports and mocks to use consistent relative paths

3. **Mock Direct Send Function**: 
   - Different command handlers used different patterns for the directSend function
   - Solution: Standardized the approach across all tests to mock validator.createDirectSend consistently

### Coverage Summary

Current coverage metrics for standardized command handlers:

| Command  | Statement Coverage | Branch Coverage | Function Coverage | Line Coverage |
|----------|-------------------|----------------|-------------------|---------------|
| list.js  | 100%              | 100%           | 100%              | 100%          |
| reset.js | 100%              | 87.5%          | 100%              | 100%          |
| status.js| 97.61%            | 56.66%         | 100%              | 100%          |
| verify.js| 91.66%            | 76.47%         | 33.33%            | 94.28%        |

## Examples

- **Auth Command**: `tests/unit/commands/handlers/auth.test.js`
- **List Command**: `tests/unit/commands/handlers/list.test.js`
- **Reset Command**: `tests/unit/commands/reset.test.js`
- **Status Command**: `tests/unit/commands/status.test.js`
- **Verify Command**: `tests/unit/commands/verify.test.js`
- **CommandLoader**: `tests/unit/commands/utils/commandLoader.test.js`

## Running Tests

To run command tests specifically:

```bash
# Run all command handler tests
npm test -- tests/unit/commands/handlers/

# Run a specific command test
npm test -- tests/unit/commands/handlers/auth.test.js
```

A dedicated script is also available:

```bash
# Run all command-related tests
./scripts/test-commands.sh
```