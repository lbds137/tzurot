# Open Handles Analysis and Solutions

## Problem Summary

Jest detected 20 open handles preventing clean exit:
- 15 timeouts from `add.js` command handler
- 3 intervals from `ProfileInfoCache.js` 
- 2 timeouts from `imageHandler.js`

All caused by tests importing real modules that create timers.

## Root Causes

### 1. Module-Level Timer Creation
```javascript
// ProfileInfoCache.js - Creates interval on instantiation
class ProfileInfoCache {
  constructor(options = {}) {
    this.cleanupInterval = this.setInterval(...); // Creates real interval!
  }
}
```

### 2. Command Handler Timers
```javascript
// add.js - Creates timeout for cleanup
scheduler(() => {
  processingMessages.delete(message.id);
}, 60000); // 1 minute real timeout!
```

### 3. Network Timeout Timers
```javascript
// imageHandler.js - Creates abort timeout
const timeoutId = timerFunctions.setTimeout(() => controller.abort(), 30000);
```

## Solutions

### Solution 1: Use Fake Timers (Quick Fix)

Add to ALL test files that import modules with timers:

```javascript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
```

### Solution 2: Mock Heavy Modules (Better)

```javascript
// Mock modules that create timers
jest.mock('../../../../src/core/api/ProfileInfoFetcher');
jest.mock('../../../../src/utils/media/imageHandler');
```

### Solution 3: Dependency Injection (Best)

For modules that support it, inject mock timers:

```javascript
// add.test.js
const mockContext = {
  scheduler: jest.fn(), // Mock setTimeout
  messageTracker: mockTracker
};

await addCommand.execute(message, args, mockContext);
```

## Specific Fixes

### Fix for add.test.js
```javascript
beforeEach(() => {
  jest.useFakeTimers();
  
  // Create mock scheduler that uses Jest's fake timers
  mockContext = {
    scheduler: (fn, delay) => setTimeout(fn, delay), // Uses fake timers
    messageTracker
  };
});
```

### Fix for ProfileInfoCache
```javascript
// Mock the entire module since it creates timers on construction
jest.mock('../../../../src/profileInfoFetcher', () => ({
  getFetcher: jest.fn().mockReturnValue({
    fetchProfileInfo: jest.fn().mockResolvedValue({})
  })
}));
```

### Fix for imageHandler
```javascript
// Use the configurable timers if available
beforeEach(() => {
  jest.useFakeTimers();
  
  const imageHandler = require('../../../../src/utils/media/imageHandler');
  if (imageHandler.configureTimers) {
    imageHandler.configureTimers({
      setTimeout: jest.fn(),
      clearTimeout: jest.fn()
    });
  }
});
```

## Prevention Guidelines

### 1. Always Check for Timers
Before importing any module in tests, check if it:
- Uses setTimeout/setInterval
- Creates cleanup timers
- Has network timeouts
- Creates scheduled tasks

### 2. Use the Right Approach
- **Light utilities**: Import directly (no timers)
- **Heavy services**: Mock completely
- **Timer-using modules**: Use fake timers
- **Network modules**: Mock the network layer

### 3. Test Template
```javascript
describe('Module with timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  
  // Tests...
});
```

### 4. Check for Open Handles
Run tests with `--detectOpenHandles`:
```bash
npx jest --detectOpenHandles tests/unit/some.test.js
```

## Common Modules That Create Timers

Always mock or use fake timers with:
- `ProfileInfoFetcher` / `ProfileInfoCache`
- `ConversationTracker`
- `AuthManager` 
- `ConversationManager`
- `messageTrackerHandler`
- `webhookUserTracker`
- Media handlers (audio/image)
- Any command that uses scheduler

## Enforcement

Add to pre-commit checks:
1. Detect imports of timer-creating modules
2. Verify fake timers are used
3. Check for proper cleanup in afterEach