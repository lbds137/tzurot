# Timer Injection and Singleton Refactoring Guide

## Problem Statement

We spent hours trying to fix a simple "setInterval is not defined" error in tests. The root cause is a fundamental design issue: **modules that execute code during import are inherently difficult to test**.

### Current Problems

1. **Singleton creates on import**: `const messageTracker = new MessageTracker()` runs immediately when the module is imported
2. **Timer functions assumed to exist**: The constructor uses `setTimeout` and `setInterval` directly
3. **No way to control initialization**: Tests can't inject mocks before the singleton is created
4. **Bandaid fixes accumulate**: We added `typeof setTimeout !== 'undefined' ? setTimeout : () => {}` checks everywhere

## The Right Solution

### 1. Never Execute Code During Import

**Bad (current approach):**
```javascript
// src/commands/utils/messageTracker.js
class MessageTracker {
  constructor() {
    // Uses timers immediately
    this.interval = setInterval(() => {}, 10000);
  }
}

// This runs immediately on import!
const messageTracker = new MessageTracker();
module.exports = messageTracker;
```

**Good (lazy initialization):**
```javascript
// src/commands/utils/messageTracker.js
class MessageTracker {
  constructor(deps = {}) {
    this.timers = deps.timers || {
      setTimeout: global.setTimeout,
      setInterval: global.setInterval,
      clearTimeout: global.clearTimeout,
      clearInterval: global.clearInterval
    };
  }
}

// Export factory, not instance
module.exports = {
  MessageTracker,
  create: (deps) => new MessageTracker(deps),
  // Backward compatibility with lazy init
  get instance() {
    if (!this._instance) {
      this._instance = new MessageTracker();
    }
    return this._instance;
  }
};
```

### 2. Dependency Injection Pattern

**Step 1: Create a Timer Service**
```javascript
// src/services/timerService.js
class TimerService {
  constructor() {
    this.setTimeout = global.setTimeout.bind(global);
    this.setInterval = global.setInterval.bind(global);
    this.clearTimeout = global.clearTimeout.bind(global);
    this.clearInterval = global.clearInterval.bind(global);
  }

  // Convenience methods
  delay(ms) {
    return new Promise(resolve => this.setTimeout(resolve, ms));
  }

  schedule(fn, ms) {
    return this.setInterval(fn, ms);
  }
}

module.exports = TimerService;
```

**Step 2: Inject Dependencies**
```javascript
// src/commands/utils/messageTracker.js
class MessageTracker {
  constructor({ timerService, enableCleanup = true } = {}) {
    this.timerService = timerService || new (require('../services/timerService'))();
    this.enableCleanup = enableCleanup;
    
    if (this.enableCleanup) {
      this._startCleanupInterval();
    }
  }

  _startCleanupInterval() {
    this.cleanupInterval = this.timerService.schedule(() => {
      this._cleanup();
    }, 10 * 60 * 1000);
  }

  stop() {
    if (this.cleanupInterval) {
      this.timerService.clearInterval(this.cleanupInterval);
    }
  }
}
```

**Step 3: Test-Friendly Usage**
```javascript
// tests/unit/messageTracker.test.js
const { MessageTracker } = require('../../src/commands/utils/messageTracker');

describe('MessageTracker', () => {
  let tracker;
  let mockTimerService;

  beforeEach(() => {
    mockTimerService = {
      setTimeout: jest.fn(),
      setInterval: jest.fn(),
      clearTimeout: jest.fn(),
      clearInterval: jest.fn(),
      delay: jest.fn().mockResolvedValue(),
      schedule: jest.fn()
    };

    tracker = new MessageTracker({ 
      timerService: mockTimerService,
      enableCleanup: false // Control features in tests
    });
  });

  // Tests work perfectly - no timer issues!
});
```

### 3. Application-Level Initialization

**Create an Application Context**
```javascript
// src/core/application.js
class Application {
  constructor() {
    this.services = {};
    this.initialized = false;
  }

  async initialize() {
    // Create all services with proper dependencies
    this.services.timers = new TimerService();
    this.services.logger = new Logger();
    this.services.messageTracker = new MessageTracker({
      timerService: this.services.timers,
      logger: this.services.logger
    });
    
    this.initialized = true;
  }

  getService(name) {
    if (!this.initialized) {
      throw new Error('Application not initialized');
    }
    return this.services[name];
  }
}

// Export singleton app instance
module.exports = new Application();
```

**Usage in Bot**
```javascript
// src/bot.js
const app = require('./core/application');

async function initBot() {
  // Initialize application first
  await app.initialize();
  
  // Now get services
  const messageTracker = app.getService('messageTracker');
  
  // Rest of bot initialization...
}
```

### 4. Migration Strategy

1. **Phase 1**: Add factory methods alongside existing exports
   ```javascript
   module.exports = messageTracker; // Keep for compatibility
   module.exports.create = (deps) => new MessageTracker(deps);
   module.exports.MessageTracker = MessageTracker;
   ```

2. **Phase 2**: Update tests to use factory
   ```javascript
   const { create } = require('../src/messageTracker');
   const tracker = create({ timerService: mockTimers });
   ```

3. **Phase 3**: Update application code to use dependency injection
4. **Phase 4**: Remove singleton exports

## Benefits of This Approach

1. **Testable**: Full control over dependencies in tests
2. **Flexible**: Easy to swap implementations (e.g., fake timers in dev)
3. **Explicit**: Dependencies are clear and documented
4. **No Magic**: No runtime checks for `typeof setTimeout`
5. **Fast Tests**: No need for complex mock setups

## Lessons Learned

1. **Singletons are an anti-pattern** for testable code
2. **Import-time execution** makes testing extremely difficult
3. **Dependency injection** solves most testing problems
4. **Explicit is better than implicit** - pass dependencies, don't assume globals

## Example: Full Refactor

Here's what messageTracker.js should look like:

```javascript
/**
 * MessageTracker - Tracks processed messages to prevent duplicates
 * 
 * This module exports a class and factory functions.
 * It does NOT create any instances during import.
 */
const logger = require('../../logger');

class MessageTracker {
  constructor(dependencies = {}) {
    // Explicit dependencies
    this.logger = dependencies.logger || logger;
    this.timers = dependencies.timers || {
      setTimeout: global.setTimeout,
      setInterval: global.setInterval,
      clearTimeout: global.clearTimeout,
      clearInterval: global.clearInterval
    };
    
    // Configuration
    this.config = {
      enableCleanup: dependencies.enableCleanup !== false,
      cleanupInterval: dependencies.cleanupInterval || 10 * 60 * 1000,
      recentCommandWindow: dependencies.recentCommandWindow || 3000
    };
    
    // State
    this.processedMessages = new Set();
    this.recentCommands = new Map();
    
    // Start cleanup if enabled
    if (this.config.enableCleanup) {
      this.startCleanup();
    }
  }

  startCleanup() {
    this.cleanupTimer = this.timers.setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  stop() {
    if (this.cleanupTimer) {
      this.timers.clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ... rest of methods
}

// Factory function
function createMessageTracker(dependencies) {
  return new MessageTracker(dependencies);
}

// For backward compatibility (to be removed)
let defaultInstance = null;
function getDefaultInstance() {
  if (!defaultInstance) {
    defaultInstance = createMessageTracker();
  }
  return defaultInstance;
}

module.exports = {
  MessageTracker,
  createMessageTracker,
  
  // Backward compatibility (deprecate these)
  get default() { return getDefaultInstance(); },
  
  // Legacy singleton methods (deprecate these)
  isProcessed: (...args) => getDefaultInstance().isProcessed(...args),
  markAsProcessed: (...args) => getDefaultInstance().markAsProcessed(...args),
  // ... etc
};
```

## Conclusion

The hours we spent on this issue were caused by fighting against bad architecture, not solving the actual problem. The real fix isn't making timers work in tests - it's designing code that's testable from the start.

**Remember**: If you're writing `typeof X !== 'undefined'` checks or environment checks (`process.env.NODE_ENV`), you're probably working around a design flaw, not fixing it.