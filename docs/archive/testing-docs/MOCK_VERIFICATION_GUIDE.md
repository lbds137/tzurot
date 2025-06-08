# Mock Verification Guide

## Overview

This guide establishes practices to prevent testing against non-existent APIs, as demonstrated by the `getAllReleases` incident where tests passed against a mocked method that didn't exist in the real implementation.

## The Problem

When tests mock methods that don't exist in the real implementation:
- Tests pass in development but fail in production
- False confidence in code coverage
- Wasted debugging time discovering the root cause
- Potential user-facing failures that could have been caught

### Real Example: The getAllReleases Bug
```javascript
// ❌ BAD: Test mocked a non-existent method
mockGithubClient.getAllReleases.mockResolvedValue([...]); // This method doesn't exist!

// ✅ GOOD: Use actual API methods
mockGithubClient.getReleasesBetween.mockResolvedValue([...]);
```

## Enforcement Strategies

### 1. Mock Verification Script

Create an automated script that verifies mocked methods exist in the real implementation.

```javascript
// scripts/verify-mocks.js
const fs = require('fs');
const path = require('path');

function extractMockedMethods(testFile) {
  const content = fs.readFileSync(testFile, 'utf8');
  const mockPattern = /mock(\w+)\.(\w+)\.(mockResolvedValue|mockReturnValue|mockImplementation)/g;
  const methods = [];
  
  let match;
  while ((match = mockPattern.exec(content)) !== null) {
    methods.push({
      object: match[1],
      method: match[2],
      file: testFile
    });
  }
  
  return methods;
}

function verifyMethodExists(className, methodName) {
  // Load the actual class and check if method exists
  try {
    const ClassImpl = require(`../src/${className}`);
    return typeof ClassImpl.prototype[methodName] === 'function';
  } catch (error) {
    console.error(`Could not load class ${className}`);
    return false;
  }
}

// Run verification across all test files
```

### 2. TypeScript-Style JSDoc Interfaces

Use JSDoc to define interfaces that both implementations and mocks must follow:

```javascript
/**
 * @typedef {Object} IGitHubReleaseClient
 * @property {function(string): Promise<Object>} getReleaseByTag
 * @property {function(string, string): Promise<Array>} getReleasesBetween
 * @property {function(Object): Object} parseReleaseChanges
 * @property {function(Object, boolean): string} formatReleaseNotes
 */

// In the implementation
/**
 * @implements {IGitHubReleaseClient}
 */
class GitHubReleaseClient {
  // Implementation must match interface
}

// In tests
/**
 * @type {IGitHubReleaseClient}
 */
const mockGithubClient = {
  getReleaseByTag: jest.fn(),
  getReleasesBetween: jest.fn(),
  parseReleaseChanges: jest.fn(),
  formatReleaseNotes: jest.fn(),
  // getAllReleases: jest.fn(), // This would cause a type error!
};
```

### 3. Use Existing Mock System

**IMPORTANT**: We already have a consolidated mock system under `tests/__mocks__/`. Use it!

```javascript
// ✅ GOOD: Use the existing mock system
const { presets } = require('../../__mocks__');
const mockEnv = presets.commandTest();

// Or for more control:
const { modules } = require('../../__mocks__');
const mockGithubClient = modules.createGitHubReleaseClient();

// ❌ BAD: Creating ad-hoc mocks
const mockGithubClient = {
  getAllReleases: jest.fn(), // This method might not exist!
  // ...
};
```

For adding new mocks to the system, extend the existing `__mocks__/modules.js`:

```javascript
// In __mocks__/modules.js
function createGitHubReleaseClient(options = {}) {
  const GitHubReleaseClient = require('../../src/core/notifications/GitHubReleaseClient');
  
  // Create mocks based on ACTUAL methods
  const methods = Object.getOwnPropertyNames(GitHubReleaseClient.prototype)
    .filter(name => name !== 'constructor');
    
  const mock = methods.reduce((acc, method) => {
    acc[method] = jest.fn();
    return acc;
  }, {});
  
  // Add instance properties
  mock.owner = options.owner || 'testowner';
  mock.repo = options.repo || 'testrepo';
  
  return mock;
}
```

### 4. Pre-commit Hook for Mock Verification

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash

# Run mock verification on staged test files
staged_tests=$(git diff --cached --name-only | grep -E '\.test\.js$')

if [ ! -z "$staged_tests" ]; then
  echo "Verifying mocks in test files..."
  node scripts/verify-mocks.js $staged_tests
  
  if [ $? -ne 0 ]; then
    echo "❌ Mock verification failed! Some mocked methods don't exist in real implementations."
    exit 1
  fi
fi
```

### 5. Test Structure Best Practices

```javascript
describe('ReleaseNotificationManager', () => {
  let manager;
  let mockGithubClient;
  
  beforeEach(() => {
    // ✅ GOOD: Import the real class to verify structure
    const GitHubReleaseClient = require('../../../../src/core/notifications/GitHubReleaseClient');
    
    // ✅ GOOD: Create mock that mirrors real implementation
    mockGithubClient = {
      // Only mock methods that actually exist
      ...Object.getOwnPropertyNames(GitHubReleaseClient.prototype)
        .filter(name => name !== 'constructor')
        .reduce((acc, method) => {
          acc[method] = jest.fn();
          return acc;
        }, {}),
      owner: 'testowner',
      repo: 'testrepo',
    };
  });
});
```

### 6. Documentation Requirements

For each mocked dependency:
1. Document which methods are being mocked
2. Reference the source file where these methods are defined
3. Include a "Mock Contract" comment

```javascript
/**
 * Mock Contract: GitHubReleaseClient
 * Source: src/core/notifications/GitHubReleaseClient.js
 * Methods:
 * - getReleaseByTag(version: string): Promise<Object|null>
 * - getReleasesBetween(fromVersion: string, toVersion: string): Promise<Array>
 * - parseReleaseChanges(release: Object): Object
 * - formatReleaseNotes(release: Object, includeFullNotes: boolean): string
 */
const mockGithubClient = {
  getReleaseByTag: jest.fn(),
  getReleasesBetween: jest.fn(),
  parseReleaseChanges: jest.fn(),
  formatReleaseNotes: jest.fn(),
};
```

## Current State & Technical Debt

### The Problem We Have

1. **Consolidated mock system exists** but isn't being used consistently
2. **New components** (GitHubReleaseClient, VersionTracker, etc.) were never added to `__mocks__/modules.js`
3. **Tests create ad-hoc mocks** leading to the `getAllReleases` bug
4. **No enforcement** until now meant this problem grew unchecked

### Why This Happened

- Initial mock system was well-designed
- As new features were added, developers took shortcuts
- Created inline mocks instead of extending the consolidated system
- No automated checks to catch this anti-pattern
- Result: Tests that pass against imaginary APIs

## Implementation Checklist

### Immediate Actions
- [x] Add mock verification to pre-commit hook
- [x] Create `scripts/verify-mock-methods.js` 
- [ ] Extend `__mocks__/modules.js` with missing components
- [ ] Migrate existing tests to use consolidated mocks

### Long-term Fixes
- [ ] Add JSDoc interfaces for all major service classes
- [ ] Update testing guidelines to require Mock Contracts
- [ ] Run initial audit of existing tests for non-existent mocks
- [ ] Create GitHub issue to track mock system migration

## Benefits

1. **Early Detection**: Catch API mismatches during development
2. **Reduced Debugging**: No more "works in tests, fails in production"
3. **Better Documentation**: Clear contracts between tests and implementations
4. **Refactoring Safety**: Changes to APIs are immediately flagged in tests

## Related Documentation

- [Test Anti-patterns Reference](./TEST_ANTIPATTERNS_REFERENCE.md)
- [Mock Pattern Rules](./MOCK_PATTERN_RULES.md)
- [Behavior-Based Testing](./BEHAVIOR_BASED_TESTING.md)