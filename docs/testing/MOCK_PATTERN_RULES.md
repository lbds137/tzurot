# Test Mock Pattern Rules

This document outlines the enforced rules for test mocking patterns in the Tzurot project.

## 🚨 Enforcement

These rules are enforced by:
- **Pre-commit hooks** - Prevents committing tests with deprecated patterns
- **CI/CD checks** - Blocks PRs with mock pattern violations
- **npm run lint:test-mocks** - Manual check for all test files

## ✅ Required: Use Consolidated Mock System

All new tests MUST use one of these approaches:

### Option 1: Migration Helper (Recommended for gradual migration)
```javascript
const { createMigrationHelper } = require('../../../utils/testEnhancements');

describe('My Test', () => {
  let migrationHelper;
  
  beforeEach(() => {
    migrationHelper = createMigrationHelper();
    const mockMessage = migrationHelper.bridge.createCompatibleMockMessage();
    // Use mockMessage...
  });
});
```

### Option 2: Direct Preset Usage (Recommended for new tests)
```javascript
const { presets } = require('../../__mocks__');

describe('My Test', () => {
  let mockEnv;
  
  beforeEach(() => {
    mockEnv = presets.commandTest();
    const message = mockEnv.discord.createMessage();
    // Use message...
  });
});
```

## 🚫 Deprecated Patterns

The following patterns will trigger warnings/errors:

### 1. jest.doMock()
```javascript
// ❌ DEPRECATED
jest.doMock('../../../../src/personalityManager', () => ({
  getPersonality: jest.fn()
}));

// ✅ USE INSTEAD
const { presets } = require('../../__mocks__');
const mockEnv = presets.commandTest();
// mockEnv.modules.personalityManager is already mocked
```

### 2. Legacy Mock Imports
```javascript
// ❌ DEPRECATED
const { createMockMessage } = require('../../utils/discordMocks');
const { createPersonalityManagerMock } = require('../../utils/mockFactories');
const { MockAIClient } = require('../../utils/apiMocks');

// ✅ USE INSTEAD
const { presets } = require('../../__mocks__');
const mockEnv = presets.commandTest();
```

### 3. helpers.createMockMessage()
```javascript
// ❌ DEPRECATED
const helpers = require('../../../utils/commandTestHelpers');
const mockMessage = helpers.createMockMessage();

// ✅ USE INSTEAD
const { createMigrationHelper } = require('../../../utils/testEnhancements');
const migrationHelper = createMigrationHelper();
const mockMessage = migrationHelper.bridge.createCompatibleMockMessage();
```

### 4. jest.resetModules()
```javascript
// ❌ PROBLEMATIC - Breaks helper imports
jest.resetModules();

// ✅ USE INSTEAD
jest.clearAllMocks(); // Clears mock calls without breaking imports
```

## ⚔️ Conflicting Patterns

Never mix old and new patterns in the same file:

```javascript
// ❌ BAD - Mixing patterns
const helpers = require('../../../utils/commandTestHelpers');
const { createMigrationHelper } = require('../../../utils/testEnhancements');

// ✅ GOOD - Pick one approach
const { createMigrationHelper } = require('../../../utils/testEnhancements');
```

## 📋 Migration Checklist

When updating a test file:

1. **Remove jest.doMock()** - Replace with preset mocks
2. **Remove legacy imports** - Use consolidated mocks
3. **Replace helpers.createMockMessage()** - Use migration helper
4. **Remove jest.resetModules()** - Use jest.clearAllMocks()
5. **Test still passes** - Verify functionality preserved

## 🛠️ Enforcement Commands

```bash
# Check all test files
npm run lint:test-mocks

# Check specific files
node scripts/check-test-mock-patterns.js tests/unit/mytest.test.js

# Strict mode (all issues are errors)
node scripts/check-test-mock-patterns.js --strict

# Fix common issues automatically
node scripts/fix-jest-reset-modules.js
node scripts/fix-helpers-not-defined.js
```

## 📚 Resources

- **Migration Guide**: `tests/__mocks__/MIGRATION_GUIDE.md`
- **Mock System Docs**: `tests/__mocks__/README.md`
- **Examples**: See `tests/unit/bot.features.test.js` for a properly migrated test

## 🎯 Goal

The goal is to have ALL tests using the consolidated mock system. This provides:
- **Consistency** - One way to mock across all tests
- **Maintainability** - Changes in one place affect all tests
- **Performance** - Reusable mock instances
- **Type Safety** - Better IDE support with consistent APIs

## 🚦 Gradual Migration Strategy

1. **Phase 1** (Current): Enforcement prevents new violations
2. **Phase 2**: Migrate high-value tests (frequently modified)
3. **Phase 3**: Bulk migration of remaining tests
4. **Phase 4**: Remove legacy mock files

We're taking a gradual approach to avoid breaking everything at once. The enforcement ensures we don't make the problem worse while we migrate.