# Mock Interface Mismatch Prevention Guide

## Problem Statement

During the DDD migration, we discovered critical testing issues where:
1. Tests mocked methods that didn't exist in real implementations (`canEmbed`, `respondWithEmbed`, `getAuthorDisplayName`, `getAuthorAvatarUrl`)
2. Repository method names were mocked incorrectly (`findByOwnerId` vs `findByOwner`)
3. Tests passed with 100% coverage but the code failed in production

This document outlines strategies to prevent these issues.

## Root Causes

### 1. Ad-hoc Mock Creation
```javascript
// ❌ BAD: Creating mocks without verifying interface
const mockContext = {
  canEmbed: jest.fn(),  // Does this method exist?
  respondWithEmbed: jest.fn(),  // Does this method exist?
  // ... who knows what else is missing?
};
```

### 2. No Interface Contract Verification
```javascript
// ❌ BAD: Mocking repository methods that don't exist
const mockRepository = {
  findByOwnerId: jest.fn(),  // Real method is findByOwner!
};
```

### 3. Over-reliance on Unit Tests
- Unit tests with mocks don't catch interface mismatches
- No integration tests to verify real implementations work together
- False confidence from high coverage numbers

## Solutions

### 1. Use Real Classes with Selective Mocking

```javascript
// ✅ GOOD: Use real class, mock only external dependencies
const { CommandContext } = require('../../../../src/application/commands/CommandAbstraction');

const context = new CommandContext({
  platform: 'discord',
  message: mockMessage,
  author: mockAuthor,
  // ... other required fields
});

// Now if you try to call context.canEmbed() and it doesn't exist, test fails!
```

### 2. Create Factory Functions for Test Objects

```javascript
// ✅ GOOD: Factory that creates valid instances
function createTestCommandContext(overrides = {}) {
  const { CommandContext } = require('../../../../src/application/commands/CommandAbstraction');
  
  return new CommandContext({
    platform: 'discord',
    isSlashCommand: false,
    message: createMockMessage(),
    author: createMockAuthor(),
    channel: createMockChannel(),
    guild: createMockGuild(),
    args: [],
    options: {},
    dependencies: {},
    ...overrides
  });
}
```

### 3. Interface Validation Tests

```javascript
// ✅ GOOD: Test that verifies expected interface exists
describe('CommandContext Interface', () => {
  it('should have all required methods', () => {
    const context = createTestCommandContext();
    
    // Verify methods exist
    expect(typeof context.canEmbed).toBe('function');
    expect(typeof context.respondWithEmbed).toBe('function');
    expect(typeof context.getAuthorDisplayName).toBe('function');
    expect(typeof context.getAuthorAvatarUrl).toBe('function');
    expect(typeof context.respond).toBe('function');
    expect(typeof context.getUserId).toBe('function');
    expect(typeof context.getChannelId).toBe('function');
    expect(typeof context.isDM).toBe('function');
  });
});
```

### 4. Integration Tests for Critical Paths

```javascript
// ✅ GOOD: Integration test using real implementations
describe('ListCommand Integration', () => {
  it('should work with real CommandContext and PersonalityService', async () => {
    // Use real implementations, only mock external systems
    const personalityService = new PersonalityApplicationService({
      personalityRepository: new FilePersonalityRepository({ dataPath: './test-data' }),
      aiService: mockAIService,  // Mock only external service
      authenticationRepository: mockAuthRepository,
      eventBus: new DomainEventBus()
    });
    
    const context = createTestCommandContext({
      dependencies: {
        personalityApplicationService: personalityService,
        botPrefix: '!tz'
      }
    });
    
    const command = createListCommand();
    await command.execute(context);
    
    // Verify it actually works end-to-end
  });
});
```

### 5. Mock Verification Utilities

```javascript
// ✅ GOOD: Utility to verify mocks match interfaces
function verifyMockInterface(mock, realClass) {
  const realInstance = new realClass();
  const realMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(realInstance))
    .filter(name => typeof realInstance[name] === 'function' && name !== 'constructor');
  
  const mockMethods = Object.keys(mock)
    .filter(key => typeof mock[key] === 'function' || jest.isMockFunction(mock[key]));
  
  const missing = realMethods.filter(method => !mockMethods.includes(method));
  const extra = mockMethods.filter(method => !realMethods.includes(method));
  
  if (missing.length > 0) {
    throw new Error(`Mock is missing methods: ${missing.join(', ')}`);
  }
  
  if (extra.length > 0) {
    throw new Error(`Mock has extra methods that don't exist: ${extra.join(', ')}`);
  }
}

// Usage
verifyMockInterface(mockRepository, FilePersonalityRepository);
```

## Implementation Plan

### Phase 1: Immediate Actions (Post-DDD)
1. **Audit all existing tests** for ad-hoc mocks
2. **Create interface validation tests** for all major contracts
3. **Add integration tests** for critical user paths

### Phase 2: Systematic Improvements
1. **Complete mock consolidation** (currently at ~5%)
2. **Create test factories** for all domain objects
3. **Add mock verification** to test setup

### Phase 3: Long-term Solutions
1. **Consider TypeScript migration** for compile-time interface checking
2. **Implement contract testing** between services
3. **Add integration test requirements** to PR checklist

## Testing Checklist

Before merging any PR, ensure:

- [ ] No ad-hoc mock objects (use real classes or consolidated mocks)
- [ ] All mocked methods verified to exist on real class
- [ ] Integration test exists for the feature
- [ ] Factory functions used for test object creation
- [ ] No mocking of methods that return other domain objects

## Examples of What to Fix

### Repository Mocks
```javascript
// ❌ BEFORE: Ad-hoc mock with wrong method name
const mockRepo = {
  findByOwnerId: jest.fn()  // Wrong name!
};

// ✅ AFTER: Use real class or verified mock
import { createMockPersonalityRepository } from '../../../__mocks__/repositories';
const mockRepo = createMockPersonalityRepository();
// This factory ensures all methods match the real interface
```

### Command Context Mocks
```javascript
// ❌ BEFORE: Ad-hoc mock with made-up methods
const mockContext = {
  canEmbed: jest.fn(),
  someMethod: jest.fn()  // Does this exist?
};

// ✅ AFTER: Use real CommandContext
const context = new CommandContext({
  // ... required fields
});
// Spy on specific methods if needed
jest.spyOn(context, 'canEmbed');
```

## Monitoring and Enforcement

1. **Add pre-commit hook** to detect ad-hoc mocks
2. **Update code review checklist** to check for interface mismatches
3. **Track mock consolidation progress** in sprint goals
4. **Run integration tests in CI** separately from unit tests

## References

- [Mock Consolidation Guide](./MOCK_SYSTEM_GUIDE.md)
- [Test Philosophy and Patterns](./TEST_PHILOSOPHY_AND_PATTERNS.md)
- [Integration Testing Best Practices](./INTEGRATION_TESTING_GUIDE.md) (to be created)

---

*Last Updated: June 2025*
*Issue Discovery: DDD Phase 3 List Command Implementation*