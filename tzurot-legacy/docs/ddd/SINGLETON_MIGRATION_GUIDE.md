# Singleton Migration Guide

## Quick Reference

### ❌ Don't Do This
```javascript
// Creates instance on import
const tracker = new MessageTracker();
module.exports = tracker;
```

### ✅ Do This Instead
```javascript
// Option 1: Export class and factory
module.exports = {
  MessageTracker,
  create: (deps) => new MessageTracker(deps)
};

// Option 2: Lazy getter
let instance;
module.exports = {
  get instance() {
    if (!instance) instance = new MessageTracker();
    return instance;
  }
};
```

## Step-by-Step Migration

### 1. Find All Singletons
```bash
npm run lint:antipatterns
```

### 2. For Each Singleton Module

#### Step 1: Keep backward compatibility
```javascript
// OLD: messageTracker.js
const tracker = new MessageTracker();
module.exports = tracker;

// NEW: messageTracker.js  
class MessageTracker { /* ... */ }

// Lazy singleton
let instance;
function getInstance() {
  if (!instance) instance = new MessageTracker();
  return instance;
}

// Export both for migration
module.exports = getInstance(); // Backward compatible
module.exports.MessageTracker = MessageTracker;
module.exports.create = (deps) => new MessageTracker(deps);
```

#### Step 2: Update imports gradually
```javascript
// OLD usage
const messageTracker = require('./messageTracker');

// NEW usage in tests
const { create } = require('./messageTracker');
const tracker = create({ timers: mockTimers });

// NEW usage in production
const { instance } = require('./messageTracker');
```

#### Step 3: Remove singleton export
Once all imports are updated, remove the direct export.

## Common Patterns

### Pattern 1: Manager Classes
```javascript
// Before
class PersonalityManager { /* ... */ }
const personalityManager = new PersonalityManager();
module.exports = personalityManager;

// After
class PersonalityManager { /* ... */ }

let instance;
module.exports = {
  PersonalityManager,
  getInstance() {
    if (!instance) instance = new PersonalityManager();
    return instance;
  },
  // Backward compatible exports
  getPersonality: (...args) => module.exports.getInstance().getPersonality(...args),
  addPersonality: (...args) => module.exports.getInstance().addPersonality(...args),
};
```

### Pattern 2: Service Classes with Timers
```javascript
// Before
class RateLimiter {
  constructor() {
    setInterval(() => this.cleanup(), 60000);
  }
}
module.exports = new RateLimiter();

// After  
class RateLimiter {
  constructor(options = {}) {
    this.timers = options.timers || {
      setInterval: global.setInterval,
      clearInterval: global.clearInterval
    };
    this.cleanupInterval = null;
  }
  
  start() {
    if (!this.cleanupInterval) {
      this.cleanupInterval = this.timers.setInterval(() => this.cleanup(), 60000);
    }
  }
  
  stop() {
    if (this.cleanupInterval) {
      this.timers.clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = {
  RateLimiter,
  create: (options) => {
    const limiter = new RateLimiter(options);
    if (!options || options.autoStart !== false) {
      limiter.start();
    }
    return limiter;
  }
};
```

### Pattern 3: Configuration Objects
```javascript
// Before
const config = {
  apiUrl: process.env.API_URL || 'https://api.example.com',
  timeout: parseInt(process.env.TIMEOUT) || 5000
};
module.exports = config;

// After
function createConfig(overrides = {}) {
  return {
    apiUrl: overrides.apiUrl || process.env.API_URL || 'https://api.example.com',
    timeout: overrides.timeout || parseInt(process.env.TIMEOUT) || 5000
  };
}

// Default instance for backward compatibility
const defaultConfig = createConfig();

module.exports = defaultConfig;
module.exports.createConfig = createConfig;
```

## Testing Patterns

### Before: Fighting the singleton
```javascript
// Had to do weird things like this
beforeEach(() => {
  jest.resetModules(); // Clear require cache
  // Re-require to get fresh instance
  const tracker = require('../src/messageTracker');
});
```

### After: Clean dependency injection
```javascript
const { create } = require('../src/messageTracker');

beforeEach(() => {
  tracker = create({
    timers: { setInterval: jest.fn(), clearInterval: jest.fn() },
    logger: mockLogger
  });
});
```

## Enforcement

1. **Pre-commit hooks** will block new singletons
2. **ESLint** will warn about anti-patterns
3. **npm run quality** includes anti-pattern checking

## Timeline

1. **Phase 1**: Add factory methods to all singletons (backward compatible)
2. **Phase 2**: Update tests to use factories
3. **Phase 3**: Update production code to use lazy initialization
4. **Phase 4**: Remove direct singleton exports

## Remember

> "Every hour spent fighting bad architecture could have been avoided with proper design from the start."

Make new modules testable from day one!