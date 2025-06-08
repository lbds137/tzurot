# Testing Case Studies

This document chronicles significant bugs discovered through testing (or missed by tests), analyzing root causes and lessons learned.

## Table of Contents
1. [The getAllReleases Bug](#the-getallreleases-bug)
2. [The getPersonalityByAlias API Mismatch](#the-getpersonalitybyalias-api-mismatch)
3. [The Timer Singleton Issue](#the-timer-singleton-issue)
4. [Key Lessons Summary](#key-lessons-summary)

## The getAllReleases Bug

### Date Discovered
December 2024 (caught in development)

### What Happened
Tests were passing with a mocked method `githubClient.getAllReleases()` that didn't exist in the real GitHubReleaseClient implementation. The actual method was `getReleasesBetween()`.

### The Code
```javascript
// ❌ Test (PASSED but wrong!)
mockGithubClient.getAllReleases.mockResolvedValue([
  { tag_name: 'v1.0.0', body: '## Added\n- Feature' }
]);

const releases = await manager.getAllReleases();
expect(releases).toHaveLength(1);

// ❌ Implementation (Would have FAILED in production!)
const releases = await this.githubClient.getAllReleases(); // Method doesn't exist!
```

### Root Cause Analysis

1. **Ad-hoc Mock Creation**: Test created a mock object with arbitrary methods
   ```javascript
   const mockGithubClient = {
     getAllReleases: jest.fn(), // Made up this method!
   };
   ```

2. **No Verification**: Nothing checked if mocked methods actually existed

3. **Missing from Mock System**: GitHubReleaseClient wasn't in our consolidated mock system

4. **100% Test Coverage Illusion**: Tests passed, coverage was high, but code would fail in production

### How It Was Caught
Fortunately caught during manual testing in development when the actual GitHub integration was tested.

### Preventive Measures Implemented

1. **Mock Verification Script**
   ```bash
   node scripts/verify-mock-methods.js
   ```

2. **Pre-commit Hook**: Blocks commits with non-existent mocked methods

3. **Consolidated Mock System**: Mocks based on real implementations
   ```javascript
   const { modules } = require('../../__mocks__');
   const mockClient = modules.createGitHubReleaseClient();
   // Only real methods available!
   ```

### Lessons Learned
- Never create ad-hoc mocks with arbitrary methods
- Always base mocks on real implementations
- Test coverage percentage doesn't guarantee correctness
- Integration tests would have caught this immediately

## The getPersonalityByAlias API Mismatch

### Date Discovered
June 4, 2025

### What Happened
Code throughout the codebase was calling `getPersonalityByAlias(userId, alias)` with two parameters, but the actual PersonalityManager API only accepts one parameter: `getPersonalityByAlias(alias)`.

### The Code
```javascript
// ❌ Implementation (WRONG - using 2 parameters)
const personality = getPersonalityByAlias(message.author.id, personalityName);

// ❌ Test (WRONG - expecting 2 parameters)
getPersonalityByAlias.mockImplementation((userId, alias) => {
  if (userId === 'user123' && alias === 'TestBot') {
    return mockPersonality;
  }
  return null;
});

// ✅ Actual API (Only accepts 1 parameter!)
getPersonalityByAlias(alias) {
  return this.registry.getByAlias(alias);
}
```

### Root Cause Analysis

1. **Over-Mocking**: Entire personality module was mocked
   ```javascript
   jest.mock('../../../src/core/personality');
   ```

2. **Mock Matched Bug**: Test mock accepted wrong signature
   ```javascript
   getPersonalityByAlias.mockImplementation((userId, alias) => {
     // Mock "validated" the wrong behavior!
   });
   ```

3. **No Parameter Validation**: Jest mocks accept any number of parameters

4. **Complete Isolation**: Tests never touched real implementation

### Impact
- Extra userId parameter was silently ignored
- First parameter (userId) was being used as the alias
- Personality lookups were failing in production

### How It Was Caught
Discovered during code review when someone noticed the parameter mismatch.

### Preventive Measures Implemented

1. **API Contract Tests**
   ```javascript
   it('getPersonalityByAlias accepts exactly one parameter', () => {
     expect(personalityManager.getPersonalityByAlias.length).toBe(1);
   });
   ```

2. **Integration Tests**: Tests that use real PersonalityManager

3. **JSDoc Type Annotations**
   ```javascript
   /**
    * @param {string} alias - The personality alias
    * @returns {Object|null} The personality or null
    */
   getPersonalityByAlias(alias) { }
   ```

### Lessons Learned
- Over-mocking hides API mismatches
- Tests can reinforce bugs if they mirror implementation mistakes
- Integration tests are essential for API boundary verification
- Parameter count validation is important

## The Timer Singleton Issue

### Date Discovered
Multiple incidents throughout 2024-2025

### What Happened
Tests using timer-based code were extremely slow and flaky because singleton objects created during module import couldn't use injectable timers.

### The Code
```javascript
// ❌ Problematic singleton pattern
class MessageTracker {
  constructor() {
    // Runs immediately on import!
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000); // 10 minutes
  }
}

// Created during import - can't inject test timers!
const messageTracker = new MessageTracker();
module.exports = messageTracker;
```

### Root Cause Analysis

1. **Import-Time Execution**: Objects created when module imported
   ```javascript
   const tracker = new MessageTracker(); // Runs before tests can mock!
   ```

2. **No Dependency Injection**: Timers hardcoded in constructors

3. **Singleton Pattern**: Global state made testing difficult

4. **Real Timers in Tests**: Tests had to wait for real delays

### Impact
- Test suite took 2+ minutes instead of 30 seconds
- Flaky tests due to timing issues
- Developers disabled timer-based tests
- CI/CD pipeline slowdowns

### How It Was Fixed

1. **Injectable Timers**
   ```javascript
   class MessageTracker {
     constructor(options = {}) {
       this.scheduler = options.scheduler || setInterval;
       this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
     }
   }
   ```

2. **Factory Pattern Instead of Singleton**
   ```javascript
   module.exports = {
     create: (options) => new MessageTracker(options)
   };
   ```

3. **Fake Timers in Tests**
   ```javascript
   const tracker = new MessageTracker({
     scheduler: jest.fn(),
     delay: jest.fn().mockResolvedValue()
   });
   ```

### Preventive Measures Implemented

1. **Timer Pattern Enforcement**
   ```bash
   node scripts/check-timer-patterns.js
   ```

2. **ESLint Rules**: Detect non-injectable timer patterns

3. **No Import-Time Execution**: Enforce lazy initialization

### Lessons Learned
- Never execute code during module import
- Always make external dependencies injectable
- Singleton pattern is problematic for testing
- Timer-based code needs special attention

## Key Lessons Summary

### 1. Mock Wisely
- **Don't over-mock**: Use real implementations when safe
- **Verify mock methods exist**: Prevent getAllReleases-style bugs
- **Use consolidated mock system**: Single source of truth

### 2. Test at Multiple Levels
- **Unit tests**: Fast, focused, isolated
- **Integration tests**: Catch API mismatches
- **Contract tests**: Verify API signatures
- **End-to-end tests**: Catch system-level issues

### 3. Design for Testability
- **Dependency injection**: Make everything injectable
- **No import-time execution**: Lazy initialization
- **Avoid singletons**: Use factory patterns
- **Clear API contracts**: Document and verify

### 4. Enforce Standards
- **Automated checks**: Pre-commit hooks, CI/CD
- **Code review**: Catch what automation misses
- **Documentation**: Share lessons learned
- **Continuous improvement**: Boy Scout Rule

### 5. Remember the Fundamentals
- **High coverage ≠ bug-free code**
- **Tests can reinforce bugs if wrong**
- **Integration points are bug magnets**
- **Real-world usage beats mocked tests**

---

These case studies demonstrate that effective testing requires the right balance of isolation and integration, careful mock design, and constant vigilance against patterns that make testing difficult or unreliable.