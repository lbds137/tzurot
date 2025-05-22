# Mock System Migration Guide

This guide explains how to migrate from the old scattered mock system to the new consolidated DRY system.

## What Changed

### Before (Problems)
```
tests/
├── __mocks__/node-fetch.js           # Basic fetch mock
├── mocks/discord.js.mock.js          # Discord classes
├── mocks/profileInfoFetcher.mocks.js # Profile-specific mocks
├── utils/apiMocks.js                 # Comprehensive API mocking
├── utils/discordMocks.js             # Discord factory functions
├── utils/fsMocks.js                  # File system mocks
├── utils/mockFactories.js            # Various mock factories
└── utils/commandTestHelpers.js       # Command test utilities
```

**Issues:**
- ❌ Duplicate Discord mock implementations
- ❌ Inconsistent APIs across mock files  
- ❌ Three different fetch mocking approaches
- ❌ Scattered mock utilities
- ❌ No unified configuration system

### After (Solution)
```
tests/__mocks__/
├── index.js          # Main entry point with presets
├── discord.js        # Unified Discord.js mocks
├── api.js           # Unified API mocks (fetch, AI, etc.)
├── modules.js       # Application module mocks
├── node-fetch.js    # Jest automatic mock (uses api.js)
├── README.md        # Documentation
└── MIGRATION_GUIDE.md # This file
```

**Benefits:**
- ✅ Single source of truth for each mock type
- ✅ Consistent APIs across all mocks
- ✅ DRY - no duplicate implementations
- ✅ Preset configurations for common scenarios
- ✅ Comprehensive and maintainable

## Migration Examples

### Command Tests

#### Before
```javascript
const { createMockMessage } = require('../../utils/discordMocks');
const mockPersonalityManager = require('../../utils/mockFactories').createPersonalityManagerMock();
const mockValidator = require('../../utils/mockFactories').createValidatorMock();

jest.mock('../../../src/personalityManager', () => mockPersonalityManager);
jest.mock('../../../src/commands/utils/commandValidator', () => mockValidator);

describe('Command Test', () => {
  it('should work', () => {
    const message = createMockMessage({
      content: '!tz test',
      author: { id: 'user-123' }
    });
    // Test logic...
  });
});
```

#### After
```javascript
const { presets } = require('../../__mocks__');

describe('Command Test', () => {
  let mockEnv;
  
  beforeEach(() => {
    mockEnv = presets.commandTest({
      userPermissions: ['ADMINISTRATOR']
    });
  });
  
  it('should work', () => {
    const message = mockEnv.discord.createMessage({
      content: '!tz test',
      author: { id: 'user-123' }
    });
    // Test logic...
  });
});
```

### API/Webhook Tests

#### Before
```javascript
const { MockAIClient, createMockFetch } = require('../../utils/apiMocks');
const { setupFetchSuccess } = require('../../mocks/profileInfoFetcher.mocks');

describe('API Test', () => {
  let mockFetch;
  
  beforeEach(() => {
    mockFetch = createMockFetch();
    setupFetchSuccess(mockFetch);
  });
  
  it('should handle API calls', async () => {
    // Complex setup...
  });
});
```

#### After
```javascript
const { presets } = require('../../__mocks__');

describe('API Test', () => {
  let mockEnv;
  
  beforeEach(() => {
    mockEnv = presets.webhookTest({
      mockResponses: {
        'test-personality': 'Custom AI response'
      }
    });
  });
  
  it('should handle API calls', async () => {
    // Simple, consistent API
    const response = await mockEnv.api.ai.createChatCompletion({
      messages: [{ role: 'user', content: 'test' }]
    });
    expect(response.choices[0].message.content).toContain('Custom AI response');
  });
});
```

## Preset Reference

### `presets.commandTest(options)`
Perfect for command handler tests.
```javascript
const mockEnv = presets.commandTest({
  userPermissions: ['ADMINISTRATOR', 'MANAGE_MESSAGES'],
  channelType: 'text',
  nsfw: false,
  discord: { /* discord options */ },
  modules: { /* module options */ }
});
```

### `presets.webhookTest(options)`
Perfect for AI/webhook integration tests.
```javascript
const mockEnv = presets.webhookTest({
  mockResponses: {
    'personality-name': 'Custom response'
  },
  api: { /* api options */ },
  discord: { webhookSupport: true }
});
```

### `presets.integrationTest(options)`
Perfect for full integration tests.
```javascript
const mockEnv = presets.integrationTest({
  discord: { fullSupport: true },
  api: { fullSupport: true },
  modules: { fullSupport: true }
});
```

## Advanced Migration Patterns

### Custom Module Mocking
#### Before
```javascript
const mockLogger = jest.fn();
mockLogger.info = jest.fn();
mockLogger.error = jest.fn();
// etc...

jest.mock('../../../src/logger', () => mockLogger);
```

#### After
```javascript
const { modules } = require('../../__mocks__');

const moduleEnv = modules.createModuleEnvironment({
  logger: { debug: true } // Enable debug logging for tests
});

// Use moduleEnv.logger with all methods available
```

### Custom API Responses
#### Before
```javascript
const mockFetch = jest.fn().mockImplementation((url) => {
  if (url.includes('/profile/')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: '123', name: 'Test' })
    });
  }
  // Handle other URLs...
});

jest.mock('node-fetch', () => mockFetch);
```

#### After
```javascript
const { api } = require('../../__mocks__');

const apiEnv = api.createApiEnvironment();
apiEnv.fetch.setResponse('/profile/', {
  ok: true,
  data: { id: '123', name: 'Test' }
});
```

## Files Safe to Remove

Once you've migrated your tests, these old files can be removed:
- ❌ `tests/mocks/discord.js.mock.js` (replaced by `tests/__mocks__/discord.js`)
- ❌ `tests/mocks/profileInfoFetcher.mocks.js` (functionality in `tests/__mocks__/api.js`)
- ❌ `tests/utils/apiMocks.js` (consolidated into `tests/__mocks__/api.js`)
- ❌ `tests/utils/discordMocks.js` (consolidated into `tests/__mocks__/discord.js`)
- ❌ `tests/utils/mockFactories.js` (consolidated into `tests/__mocks__/modules.js`)

Keep these files:
- ✅ `tests/__mocks__/*` (new consolidated system)
- ✅ `tests/utils/commandTestHelpers.js` (still useful for command-specific helpers)
- ✅ `tests/utils/fsMocks.js` (specialized file system mocking)

## Quick Reference

```javascript
// Import the new system
const { presets, discord, api, modules } = require('../__mocks__');

// Use presets for common scenarios
const mockEnv = presets.commandTest();
const mockEnv = presets.webhookTest();
const mockEnv = presets.integrationTest();

// Or create manually for fine control
const discordEnv = discord.createDiscordEnvironment();
const apiEnv = api.createApiEnvironment();
const moduleEnv = modules.createModuleEnvironment();

// Access mocks through consistent APIs
const message = mockEnv.discord.createMessage();
const response = await mockEnv.api.fetch.fetch('/api/test');
mockEnv.modules.personalityManager.addPersonality();
```

This consolidated system provides better maintainability, consistency, and developer experience while reducing code duplication by ~60%.