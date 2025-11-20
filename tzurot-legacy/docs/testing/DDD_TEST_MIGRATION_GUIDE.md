# DDD Test Migration Guide

This guide provides patterns for safely migrating DDD tests to use the consolidated mock system. **IMPORTANT**: All migrations should be done manually and carefully to avoid breaking tests.

## Overview

We are migrating DDD tests to use a consistent mock pattern that:

1. Clearly documents test boundaries
2. Uses consolidated mocks for external dependencies
3. Never mocks the code under test
4. Follows consistent patterns across all test types

## Migration Safety Checklist

Before migrating any test:

1. ✅ Create a backup using `scripts/backup-ddd-tests.sh`
2. ✅ Validate syntax after changes with `scripts/validate-test-syntax.js`
3. ✅ Run the test to ensure it still passes
4. ✅ Compare test output before/after to ensure no behavior changed

## Test Type Patterns

### 1. Pure Domain Tests (Value Objects, Entities)

For tests with NO external dependencies:

```javascript
/**
 * @jest-environment node
 * @testType domain
 *
 * [Description of what's being tested]
 * - Pure domain test with no external dependencies
 * - Tests business rules and validation logic
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');

describe('PersonalityId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No console mocking needed for pure domain tests
  });

  // ... test cases remain unchanged
});
```

**Example**: `PersonalityId.test.js`, `Alias.test.js`, `UserId.test.js`

### 2. Repository/Adapter Tests

For tests with file system, database, or external API dependencies:

```javascript
/**
 * @jest-environment node
 * @testType adapter
 *
 * [Description of adapter/repository]
 * - Tests [what it does]
 * - Mocks external dependencies ([list them])
 * - Domain models are NOT mocked (real integration)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Mock external dependencies FIRST (before any imports)
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
  },
}));

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Now import mocked modules
const fs = require('fs').promises;

// Adapter under test - NOT mocked!
const {
  FilePersonalityRepository,
} = require('../../../../src/adapters/persistence/FilePersonalityRepository');

// Domain models - NOT mocked! We want real domain logic
const { Personality, PersonalityId } = require('../../../../src/domain/personality');

describe('FilePersonalityRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Set up mock behavior
    fs.mkdir.mockResolvedValue();
    // ... more mock setup
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ... test cases
});
```

**Example**: `FilePersonalityRepository.test.js`, `FileAuthenticationRepository.test.js`

### 3. Service Tests with Dependencies

For domain services that orchestrate multiple components:

```javascript
/**
 * @jest-environment node
 * @testType domain-service
 *
 * [Service description]
 * - Tests service coordination logic
 * - Mocks infrastructure dependencies
 * - Uses real domain models
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Get test environment with common mocks
const testEnv = dddPresets.domainTest({
  eventBus: true,
  timers: true,
});

// Mock infrastructure
jest.mock('../../../../src/infrastructure/eventBus', () => testEnv.eventBus);

// Service under test
const { PersonalityService } = require('../../../../src/domain/personality/PersonalityService');

// Real domain models
const { Personality, PersonalityEvents } = require('../../../../src/domain/personality');

describe('PersonalityService', () => {
  let service;
  let mockRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      // ... other methods
    };

    service = new PersonalityService({
      repository: mockRepository,
      eventBus: testEnv.eventBus,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ... test cases
});
```

### 4. Discord Adapter Tests

For Discord-specific adapters:

```javascript
/**
 * @jest-environment node
 * @testType adapter
 *
 * Discord[Component]Adapter Test
 * - Tests Discord.js integration
 * - Mocks Discord.js (external dependency)
 * - Uses real domain models
 */

const { presets } = require('../../../__mocks__');

// Use Discord-specific preset
const mockEnv = presets.webhookTest({
  discord: {
    webhookSupport: true,
    // ... Discord mock config
  },
});

// Mock Discord.js
jest.mock('discord.js', () => mockEnv.discord);

// Adapter under test
const { DiscordWebhookAdapter } = require('../../../../src/adapters/discord/DiscordWebhookAdapter');

// Real domain models
const { Message } = require('../../../../src/domain/conversation');

describe('DiscordWebhookAdapter', () => {
  // ... test implementation
});
```

## Common Mock Patterns

### File System Mocks

```javascript
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn(),
    stat: jest.fn(),
  },
}));
```

### Logger Mocks

```javascript
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));
```

### Timer Mocks (Injectable)

```javascript
// In the component being tested
constructor(options = {}) {
  this._setInterval = options.setInterval || global.setInterval;
  this._clearInterval = options.clearInterval || global.clearInterval;
  this._setTimeout = options.setTimeout || global.setTimeout;
  this._clearTimeout = options.clearTimeout || global.clearTimeout;
}

// In the test
const repository = new Repository({
  setInterval: jest.fn(),
  clearInterval: jest.fn()
});
```

## Migration Process

1. **Identify Test Type**
   - Pure domain (no dependencies)
   - Repository/Adapter (external dependencies)
   - Service (orchestration)
   - Integration (multiple components)

2. **Add Test Headers**

   ```javascript
   /**
    * @jest-environment node
    * @testType [domain|adapter|service|integration]
    *
    * Clear description of what's being tested
    * - List key behaviors tested
    * - List what's mocked vs real
    */
   ```

3. **Update Imports**
   - Add consolidated mock imports
   - Move jest.mock() calls BEFORE imports
   - Add comments for clarity

4. **Update Setup/Teardown**
   - Use consistent beforeEach/afterEach
   - Clear all mocks
   - Set up fake timers if needed

5. **Validate Changes**

   ```bash
   # Check syntax
   node scripts/validate-test-syntax.js path/to/test.js

   # Run test
   npx jest path/to/test.js --no-coverage

   # Run with Jest validation
   node scripts/validate-test-syntax.js path/to/test.js --jest
   ```

## What NOT to Mock

**NEVER mock the code you're testing!**

❌ **Wrong**:

```javascript
// Testing PersonalityRepository
jest.mock('../../../../src/adapters/persistence/PersonalityRepository');
```

✅ **Right**:

```javascript
// Testing PersonalityRepository
// Mock its dependencies (fs, logger) but NOT the repository itself
jest.mock('fs');
jest.mock('../../../../src/logger');
const {
  PersonalityRepository,
} = require('../../../../src/adapters/persistence/PersonalityRepository');
```

## Troubleshooting

### Jest Mock Hoisting Issues

If you see "The module factory of jest.mock() is not allowed to reference any out-of-scope variables":

- Define mocks inline in jest.mock()
- Don't reference external variables in mock factories

### Test Timeouts

If tests are timing out:

- Check for unmocked timers
- Ensure all async operations are mocked
- Use jest.useFakeTimers()

### Syntax Errors

If syntax validator reports errors:

- Check for trailing commas
- Ensure balanced braces/parentheses
- Run actual Jest to see detailed errors

## Progress Tracking

When migrating tests, update your commit message with progress:

```
test: migrate PersonalityId test to consolidated mocks

- Migrated 1 domain test
- Used dddPresets for consistency
- All tests passing

DDD test migration: 2/45 files complete
```

## Next Steps

1. Start with simple domain tests (value objects)
2. Move to repositories/adapters
3. Then services and complex tests
4. Create PR with batches of ~5-10 files

Remember: **Quality over speed!** It's better to migrate carefully than to break tests.
