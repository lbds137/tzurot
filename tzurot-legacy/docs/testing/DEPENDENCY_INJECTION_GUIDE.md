# Dependency Injection Guide for Tests

## Current State

The codebase **supports** dependency injection in many places, but only **3 out of 205** test files actually use it! This is why we have open handle issues.

## What We Have

### Modules with Injectable Timers

Many modules already support timer injection:

```javascript
// Commands support context injection
async function execute(message, args, context = {}) {
  const { scheduler = setTimeout, messageTracker = null } = context;
  // ...
}

// Services support option injection
class PersonalityManager {
  constructor(options = {}) {
    this.delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
}

// Many modules have this pattern
const defaultDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
class SomeService {
  constructor({ delay = defaultDelay } = {}) {
    this.delay = delay;
  }
}
```

## What's Missing

Most tests don't use these injection points:

```javascript
// ❌ BAD - Not using context
await addCommand.execute(message, args); // Uses real timers!

// ✅ GOOD - Using context  
const mockContext = {
  scheduler: jest.fn(),
  messageTracker: mockTracker
};
await addCommand.execute(message, args, mockContext);
```

## Complete List of Injectable Modules

### Command Handlers (via context parameter)
- `add.js` - scheduler, messageTracker
- `remove.js` - messageTracker
- `purgbot.js` - scheduler, messageTracker
- All commands follow this pattern

### Core Services (via constructor options)
- `PersonalityManager` - delay
- `ConversationManager` - interval, delay
- `ProfileInfoFetcher` - delay, setInterval
- `ReleaseNotificationManager` - delay, interval
- `AuthManager` - interval
- `RateLimiter` - delay

### Utilities (via configure methods)
- `imageHandler` - configureTimers({ setTimeout, clearTimeout })
- `audioHandler` - configureTimers({ setTimeout, clearTimeout })
- `urlValidator` - uses timerFunctions object
- `errorTracker` - timerFunctions parameter

## How to Use Dependency Injection

### 1. For Command Tests

```javascript
describe('Command Test', () => {
  let mockContext;
  
  beforeEach(() => {
    jest.useFakeTimers();
    
    mockContext = {
      scheduler: jest.fn((fn, delay) => setTimeout(fn, delay)), // Uses fake timers
      messageTracker: createMockTracker()
    };
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  it('should handle command', async () => {
    await command.execute(message, args, mockContext);
    
    // Advance fake timers if needed
    jest.advanceTimersByTime(60000);
  });
});
```

### 2. For Service Tests

```javascript
describe('Service Test', () => {
  let service;
  
  beforeEach(() => {
    jest.useFakeTimers();
    
    service = new PersonalityManager({
      delay: jest.fn().mockResolvedValue(), // Instant delays
      interval: jest.fn() // No real intervals
    });
  });
});
```

### 3. For Utility Tests

```javascript
describe('Media Handler Test', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    
    const imageHandler = require('../src/utils/media/imageHandler');
    imageHandler.configureTimers({
      setTimeout: (fn, delay) => setTimeout(fn, delay), // Fake timers
      clearTimeout: (id) => clearTimeout(id)
    });
  });
});
```

## Migration Checklist

### High Priority (Causing Open Handles)
- [ ] `add.test.js` - Use mockContext.scheduler
- [ ] `webhookManager.test.js` - Mock ProfileInfoFetcher
- [ ] `imageHandler.test.js` - Use configureTimers
- [ ] All command tests - Pass mockContext

### Medium Priority (Heavy Modules)
- [ ] Service tests - Use constructor options
- [ ] Manager tests - Inject timer functions
- [ ] Handler tests - Use context parameter

### Low Priority (Light Utilities)
- [ ] Utility tests - Use configure methods where available

## Testing Pattern

```javascript
// Template for tests with DI
describe('Module with timers', () => {
  let instance;
  let mockTimers;
  
  beforeEach(() => {
    jest.useFakeTimers();
    
    // Create mock timer functions
    mockTimers = {
      delay: jest.fn().mockResolvedValue(),
      scheduler: jest.fn((fn) => setImmediate(fn)),
      interval: jest.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms), // Uses fake
      clearTimeout: (id) => clearTimeout(id)
    };
    
    // Inject mocks based on module type
    if (isCommand) {
      instance = { execute: (msg, args) => module.execute(msg, args, mockTimers) };
    } else if (isService) {
      instance = new Module(mockTimers);
    } else if (hasConfigureMethod) {
      module.configureTimers(mockTimers);
      instance = module;
    }
  });
  
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
```

## Benefits

1. **No Open Handles** - Tests clean up properly
2. **Fast Tests** - No real delays
3. **Deterministic** - Same results every time
4. **Easy to Test** - Can control time flow

## Enforcement

Update pre-commit hooks to check:
1. If test imports timer-using module
2. If test uses DI for that module
3. If test has proper fake timer setup

## Quick Wins

Start with these 3 files (they already have DI support):
1. `add.test.js` - Already has mockContext, just needs scheduler to use fake timers
2. `purgbot.test.js` - Has mockContext pattern
3. `messageTracker.test.js` - Has injectable timers

These 3 fixes alone will eliminate 15 of the 20 open handles!