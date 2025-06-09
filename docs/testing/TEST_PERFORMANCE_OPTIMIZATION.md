# Test Performance Optimization Guide

## Current State

- **Test Suite Size**: 205 suites, 3561 tests
- **Total Runtime**: ~40-45 seconds
- **Target Runtime**: < 30 seconds
- **Key Issue**: Tests not using fake timers, causing real delays

## Performance Analysis Results

### Slowest Tests (> 2 seconds)
1. `webhookCache.test.js` - 4.1s
2. `webhookManager.simple.test.js` - 2.7s
3. `messageHandler.mentions.test.js` - 2.5s
4. `webhookManager.exports.test.js` - 2.3s
5. `messageHandler.test.js` - 2.2s

### Root Causes
1. **No Fake Timers**: 0 tests currently use `jest.useFakeTimers()`
2. **Unmocked Imports**: 196 files import real src modules without mocking
3. **Real Timer Delays**: Tests waiting for actual setTimeout/setInterval
4. **Heavy Module Loading**: Large files like webhookManager.js (2800+ lines)

## Optimization Strategies

### 1. Use Fake Timers (Highest Impact)

**Problem**: Tests with delays run in real-time
```javascript
// ❌ BAD - Takes 5 seconds
await new Promise(resolve => setTimeout(resolve, 5000));
```

**Solution**: Use fake timers
```javascript
// ✅ GOOD - Instant
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('should handle delays', async () => {
  const promise = delayFunction(5000);
  
  // Advance time instantly
  jest.advanceTimersByTime(5000);
  
  await promise; // Resolves immediately
});
```

### 2. Mock Heavy Modules

**Problem**: Loading real modules is slow
```javascript
// ❌ BAD - Loads 2800 lines of code
const webhookManager = require('../../../src/webhookManager');
```

**Solution**: Mock at the top
```javascript
// ✅ GOOD - No loading
jest.mock('../../../src/webhookManager');
const webhookManager = require('../../../src/webhookManager');
```

### 3. Use Consolidated Mocks

**Problem**: Creating mocks repeatedly
```javascript
// ❌ BAD - Recreated in every test
const mockWebhook = {
  send: jest.fn(),
  edit: jest.fn()
};
```

**Solution**: Use shared mocks
```javascript
// ✅ GOOD - Reused across tests
const { presets } = require('../../__mocks__');
const mockEnv = presets.commandTest();
```

### 4. Batch Test Operations

**Problem**: Sequential operations
```javascript
// ❌ BAD - Sequential
await operation1();
await operation2();
await operation3();
```

**Solution**: Parallel when possible
```javascript
// ✅ GOOD - Parallel
await Promise.all([
  operation1(),
  operation2(),
  operation3()
]);
```

## Implementation Plan

### Phase 1: Add Fake Timers to Slow Tests
1. Add `jest.useFakeTimers()` to top 10 slowest tests
2. Update timer-dependent code to use `jest.advanceTimersByTime()`
3. Expected improvement: 10-15 seconds

### Phase 2: Mock Heavy Modules
1. Create lightweight mocks for webhookManager, aiService
2. Use factory functions for complex mocks
3. Expected improvement: 5-10 seconds

### Phase 3: Optimize Test Structure
1. Migrate to consolidated mock system
2. Remove redundant beforeEach setup
3. Batch related assertions
4. Expected improvement: 5-10 seconds

## Quick Wins

### 1. Add to Slow Test Files
```javascript
describe('MySlowTest', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  // ... tests
});
```

### 2. Mock File System Operations
```javascript
jest.mock('fs/promises');
```

### 3. Mock Network Requests
```javascript
jest.mock('node-fetch');
```

## Measuring Progress

Run timing analysis:
```bash
# Identify slow tests
node scripts/identify-slow-tests.js

# Check for timer patterns
node scripts/check-timer-patterns.js

# Full timing analysis
node scripts/comprehensive-test-timing-analysis.js
```

## Long-term Solutions

1. **Split Large Files**: webhookManager.js needs to be broken up
2. **Lazy Loading**: Load personalities on-demand, not at startup
3. **Test Parallelization**: Run independent test suites in parallel
4. **Module Boundaries**: Better separation between domains

## Success Metrics

- [ ] All tests run in < 30 seconds
- [ ] No individual test > 1 second
- [ ] 90%+ tests use fake timers where applicable
- [ ] All heavy modules properly mocked