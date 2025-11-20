# Mock vs Real: Finding the Right Balance

## Core Principle

**Test the module under test with real code, mock everything else.**

## What to Mock vs What to Keep Real

### ✅ ALWAYS Mock These (External Dependencies)

1. **Heavy Service Modules**
   - `webhookManager` - 2800+ lines, creates webhooks
   - `aiService` - 1700+ lines, makes API calls
   - `personalityManager` - Complex state management
   - `conversationManager` - Tracks conversations
   - `auth` - Authentication logic
   - `profileInfoFetcher` - External API calls

2. **I/O Operations**
   - File system (`fs`, `fs/promises`)
   - Network requests (`node-fetch`, `axios`)
   - Database connections
   - Discord API calls

3. **Timers and Async Operations**
   - When testing logic, not timing
   - Long-running operations
   - Scheduled tasks

4. **Third-party Libraries**
   - `discord.js` - Always mock Discord client
   - External API clients
   - Heavy utility libraries

### ❌ NEVER Mock These (Module Under Test)

1. **The Module Being Tested**

   ```javascript
   // In webhookCache.test.js
   // ❌ WRONG - Don't mock what you're testing!
   jest.mock('../../../src/utils/webhookCache');

   // ✅ RIGHT - Import the real module
   const webhookCache = require('../../../src/utils/webhookCache');
   ```

2. **Pure Utility Functions**
   - `contentSimilarity` - Pure calculations
   - `urlValidator` - Simple validation
   - `embedUtils` - Data transformation
   - `constants` - Static values

3. **Value Objects and Domain Models**
   - Simple classes with no external dependencies
   - Data structures
   - Enums and constants

## Examples of Good Balance

### Example 1: Testing webhookCache

```javascript
// webhookCache.test.js

// ✅ Mock external dependencies
jest.mock('discord.js'); // Heavy external library
jest.mock('../../../src/logger'); // Logging is external

// ✅ Import real module under test
const webhookCache = require('../../../src/utils/webhookCache');

// ✅ Also OK to import light utilities if needed
const { isValidUrl } = require('../../../src/utils/urlValidator');
```

### Example 2: Testing a Handler

```javascript
// messageHandler.test.js

// ✅ Mock heavy dependencies
jest.mock('../../../src/personalityHandler');
jest.mock('../../../src/aiService');
jest.mock('../../../src/webhookManager');

// ✅ Import real module under test
const messageHandler = require('../../../src/handlers/messageHandler');

// ✅ Import real utilities that handler uses
const { calculateSimilarity } = require('../../../src/utils/contentSimilarity');
```

### Example 3: Testing a Service

```javascript
// aiService.test.js

// ✅ Mock external APIs and heavy dependencies
jest.mock('openai');
jest.mock('../../../src/conversationManager');
jest.mock('../../../src/auth');

// ✅ Import real module under test
const aiService = require('../../../src/aiService');

// ❌ Don't mock internal methods of aiService!
// Test through the public API
```

## Anti-Patterns to Avoid

### 1. Over-Mocking (Testing Mocks Instead of Code)

```javascript
// ❌ BAD - Mocking everything
jest.mock('../../../src/utils/webhookCache');
const webhookCache = require('../../../src/utils/webhookCache');

it('should call getOrCreateWebhook', () => {
  webhookCache.getOrCreateWebhook.mockResolvedValue({});
  // This tests nothing! Just testing that mocks work
});
```

### 2. Under-Mocking (Slow, Flaky Tests)

```javascript
// ❌ BAD - No mocks, real API calls
const aiService = require('../../../src/aiService');

it('should get AI response', async () => {
  const response = await aiService.getResponse('Hello');
  // This makes real API calls! Slow and flaky
});
```

### 3. Mocking Internals

```javascript
// ❌ BAD - Mocking private methods
jest.spyOn(aiService, '_formatMessage');
jest.spyOn(aiService, '_validateInput');

// Test the public API instead!
```

## Decision Framework

When deciding whether to mock:

1. **Is it the module I'm testing?** → Keep it real
2. **Is it a heavy external service?** → Mock it
3. **Does it do I/O or network calls?** → Mock it
4. **Is it a simple utility function?** → Keep it real
5. **Would the real version make tests slow/flaky?** → Mock it
6. **Is it a third-party library?** → Usually mock it

## Best Practices

1. **Mock at the module boundary** - Don't mock individual functions
2. **Use factory functions** - Create realistic mock data
3. **Test behavior, not implementation** - Focus on outcomes
4. **Keep mocks simple** - Just enough to make tests pass
5. **Update mocks when interfaces change** - Keep them in sync

## Performance vs Correctness

The goal is fast, reliable tests that actually test your code:

- **Too many mocks** = Fast but meaningless tests
- **Too few mocks** = Slow, flaky, but thorough tests
- **Right balance** = Fast, reliable, meaningful tests

Target: Each test file should run in < 500ms while testing real functionality.
