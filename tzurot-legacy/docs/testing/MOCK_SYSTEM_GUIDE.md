# Mock System Guide

This guide consolidates all mock-related documentation, patterns, and enforcement strategies.

## Table of Contents

1. [Overview](#overview)
2. [Required Patterns](#required-patterns)
3. [Deprecated Patterns](#deprecated-patterns)
4. [Mock Verification](#mock-verification)
5. [Migration Guide](#migration-guide)
6. [Enforcement & Tools](#enforcement--tools)
7. [Best Practices](#best-practices)

## Overview

### Why a Consolidated Mock System?

After the `getAllReleases` production bug (where we mocked a non-existent method), we implemented a consolidated mock system to:

- **Prevent API mismatches** - Mocks based on real implementations
- **Ensure consistency** - One way to mock across all tests
- **Improve maintainability** - Changes in one place affect all tests
- **Enable verification** - Easy to check if mocked methods exist
- **Reduce duplication** - Reusable mock instances

### Current State

- **~5% migrated** (6 of 133 test files)
- **Enforcement active** - Pre-commit hooks prevent new violations
- **Gradual migration** - Boy Scout Rule: leave tests better than you found them

## Required Patterns

All new tests MUST use one of these approaches:

### Option 1: Migration Helper (For Updating Existing Tests)

```javascript
const { createMigrationHelper } = require('../../../utils/testEnhancements');

describe('My Test', () => {
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();
  });

  test('should handle message', async () => {
    // Create mock objects
    const mockMessage = migrationHelper.bridge.createCompatibleMockMessage({
      content: '!tz test',
      author: { id: '123', username: 'TestUser' },
    });

    // Use the mocks
    await handler.execute(mockMessage);

    // Verify behavior
    expect(mockMessage.reply).toHaveBeenCalledWith('Success!');
  });
});
```

### Option 2: Direct Preset Usage (For New Tests)

```javascript
const { presets } = require('../../__mocks__');

describe('My Test', () => {
  let mockEnv;

  beforeEach(() => {
    mockEnv = presets.commandTest();
  });

  test('should handle command', async () => {
    // Create mock objects
    const message = mockEnv.discord.createMessage({
      content: '!tz help',
      author: { id: '123' },
    });

    // Access pre-configured mocks
    mockEnv.modules.personalityManager.getPersonality.mockReturnValue({
      name: 'test-personality',
    });

    // Execute and verify
    await command.execute(message);
    expect(message.reply).toHaveBeenCalled();
  });
});
```

### Option 3: Custom Module Mocks (For Special Cases)

```javascript
const { modules } = require('../../__mocks__');

describe('GitHubReleaseClient', () => {
  let mockClient;

  beforeEach(() => {
    // Creates a mock with all real methods
    mockClient = modules.createGitHubReleaseClient({
      owner: 'testowner',
      repo: 'testrepo',
    });
  });

  test('should fetch releases', async () => {
    mockClient.getReleasesBetween.mockResolvedValue([{ tag_name: 'v1.0.0' }]);

    const releases = await mockClient.getReleasesBetween('v0.9.0', 'v1.0.0');
    expect(releases).toHaveLength(1);
  });
});
```

## Deprecated Patterns

### 🚫 Pattern 1: jest.doMock()

```javascript
// ❌ DEPRECATED - Don't use jest.doMock
jest.doMock('../../../../src/personalityManager', () => ({
  getPersonality: jest.fn(),
}));

// ✅ USE INSTEAD - Consolidated mocks
const { presets } = require('../../__mocks__');
const mockEnv = presets.commandTest();
// mockEnv.modules.personalityManager is already mocked correctly
```

### 🚫 Pattern 2: Legacy Mock Imports

```javascript
// ❌ DEPRECATED - Old mock utilities
const { createMockMessage } = require('../../utils/discordMocks');
const { createPersonalityManagerMock } = require('../../utils/mockFactories');
const { MockAIClient } = require('../../utils/apiMocks');

// ✅ USE INSTEAD - Consolidated system
const { presets } = require('../../__mocks__');
const mockEnv = presets.commandTest();
```

### 🚫 Pattern 3: Ad-hoc Mock Creation

```javascript
// ❌ DANGEROUS - May mock non-existent methods!
const mockClient = {
  getAllReleases: jest.fn(), // This method doesn't exist!
  someMethod: jest.fn(),
};

// ✅ USE INSTEAD - Based on real implementation
const { modules } = require('../../__mocks__');
const mockClient = modules.createGitHubReleaseClient();
```

### 🚫 Pattern 4: jest.resetModules()

```javascript
// ❌ PROBLEMATIC - Breaks helper imports
beforeEach(() => {
  jest.resetModules();
});

// ✅ USE INSTEAD - Just clear mocks
beforeEach(() => {
  jest.clearAllMocks();
});
```

## Mock Verification

### The Problem We're Solving

The `getAllReleases` bug happened because:

1. We mocked a method that didn't exist
2. Tests passed with the mock
3. Production failed when calling the non-existent method

### Verification Strategies

#### 1. Use the Consolidated Mock System

The safest approach is using our mock factories that create mocks based on real implementations:

```javascript
// In __mocks__/modules.js
function createGitHubReleaseClient(options = {}) {
  const GitHubReleaseClient = require('../../src/core/notifications/GitHubReleaseClient');

  // Create mocks based on ACTUAL methods
  const methods = Object.getOwnPropertyNames(GitHubReleaseClient.prototype).filter(
    name => name !== 'constructor'
  );

  const mock = methods.reduce((acc, method) => {
    acc[method] = jest.fn();
    return acc;
  }, {});

  return mock;
}
```

#### 2. JSDoc Interface Definitions

Define interfaces that both implementations and mocks must follow:

```javascript
/**
 * @typedef {Object} IGitHubReleaseClient
 * @property {function(string): Promise<Object>} getReleaseByTag
 * @property {function(string, string): Promise<Array>} getReleasesBetween
 * @property {function(Object): Object} parseReleaseChanges
 */

// Implementation must match interface
/** @implements {IGitHubReleaseClient} */
class GitHubReleaseClient {}

// Mock must match interface
/** @type {IGitHubReleaseClient} */
const mockClient = modules.createGitHubReleaseClient();
```

#### 3. Automated Verification Script

Run this to check for non-existent mocked methods:

```bash
node scripts/verify-mock-methods.js
```

## Migration Guide

### Step-by-Step Migration

1. **Identify Current Pattern**

   ```javascript
   // Look for these imports
   const helpers = require('../../../utils/commandTestHelpers');
   const { createMockMessage } = require('../../utils/discordMocks');
   ```

2. **Add Migration Helper**

   ```javascript
   const { createMigrationHelper } = require('../../../utils/testEnhancements');
   ```

3. **Update Mock Creation**

   ```javascript
   // Before
   const mockMessage = helpers.createMockMessage();

   // After
   const migrationHelper = createMigrationHelper();
   const mockMessage = migrationHelper.bridge.createCompatibleMockMessage();
   ```

4. **Remove Deprecated Patterns**
   - Remove `jest.doMock()` calls
   - Remove `jest.resetModules()`
   - Remove legacy imports

5. **Verify Tests Still Pass**
   ```bash
   npm test path/to/your/test.js
   ```

### Boy Scout Rule

When touching ANY test file:

1. **Fix your immediate task** (required)
2. **Migrate at least ONE other test** to consolidated mocks (expected)
3. **Track progress** in commit messages

Example commit message:

```
test: fix user authentication test

- Fixed failing assertion in auth test
- Migrated to consolidated mock system
- Mock migration progress: 7/133 files (5.3%)
```

## Enforcement & Tools

### Pre-commit Hook

Automatically checks for deprecated patterns:

```bash
# In .git/hooks/pre-commit
node scripts/check-test-mock-patterns.js --staged
```

### Manual Commands

```bash
# Check all test files
npm run lint:test-mocks

# Check specific files
node scripts/check-test-mock-patterns.js tests/unit/mytest.test.js

# Generate migration report
node scripts/generate-mock-migration-report.js

# Verify mock methods exist
node scripts/verify-mock-methods.js
```

### CI/CD Integration

```yaml
# In CI workflow
- name: Check Mock Patterns
  run: npm run lint:test-mocks -- --strict
```

## Best Practices

### 1. Always Verify Mock Methods Exist

```javascript
// ❌ BAD: Assuming methods exist
mockClient.someMethod = jest.fn();

// ✅ GOOD: Using factory that validates
const mockClient = modules.createClient();
mockClient.existingMethod.mockResolvedValue(data);
```

### 2. Keep Mock Definitions Close to Implementations

```javascript
// When adding a new method to a class
class MyService {
  async newMethod() {}
}

// Also update the mock factory
function createMyService() {
  return {
    existingMethod: jest.fn(),
    newMethod: jest.fn(), // Add here too!
  };
}
```

### 3. Use Type Checking Where Possible

```javascript
// Use JSDoc for type safety
/** @type {import('../../src/MyService').MyService} */
const mockService = createMyService();

// This helps IDEs catch typos
mockService.nonExistentMethod(); // IDE warning!
```

### 4. Document Mock Behavior

```javascript
// In your test
mockService.fetchUser.mockResolvedValue({
  id: '123',
  name: 'Test User',
}); // Returns standard test user

// Or in mock factory
function createMockUser(overrides = {}) {
  return {
    id: '123',
    name: 'Test User',
    email: 'test@example.com',
    ...overrides,
  };
}
```

## Quick Reference

### Do's ✅

- Use consolidated mock system (`__mocks__/`)
- Verify mocked methods exist on real objects
- Use migration helper for gradual updates
- Clear mocks with `jest.clearAllMocks()`
- Follow Boy Scout Rule when updating tests

### Don'ts ❌

- Create ad-hoc mocks with arbitrary methods
- Use `jest.doMock()` for dynamic mocking
- Import from legacy mock utilities
- Use `jest.resetModules()` (breaks imports)
- Mix old and new patterns in same file

### Migration Status

- **Current**: ~5% (6/133 files)
- **Target**: 100% by end of DDD Phase 1
- **Track progress**: `npm run mock:report`

---

By following this guide, we prevent mock-related bugs and maintain a consistent, verifiable testing approach across the codebase.
