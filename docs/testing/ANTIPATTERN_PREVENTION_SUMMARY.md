# Anti-Pattern Prevention Summary

## Overview

We've implemented a comprehensive anti-pattern detection system to catch common testing issues before they're committed. This prevents the repeated fixes we've had to make for similar problems.

## Anti-Patterns We Check For

### 1. **Timeout Anti-patterns** ⏱️
- Long `setTimeout` calls (>5 seconds)
- Promises with `setTimeout`
- Waiting for real time to pass

**Why:** These cause tests to run slowly (30+ seconds instead of milliseconds)

### 2. **Mock Cleanup Anti-patterns** 🧹
- Mocks without `clearAllMocks()`
- Mock implementations without restore
- Missing mock cleanup in `afterEach`

**Why:** Causes test pollution and flaky tests

### 3. **Async/Promise Anti-patterns** ⏳
- Missing `await` for `.resolves`/`.rejects`
- Empty `.then()` blocks
- Unhandled promise rejections

**Why:** Tests pass incorrectly or have race conditions

### 4. **Test Structure Anti-patterns** 📝
- Test descriptions >80 characters
- Empty test/describe names
- `.only()` or `.skip()` in code
- Skipped tests

**Why:** Reduces test readability and can accidentally skip tests

### 5. **Console Anti-patterns** 📢
- Unmocked `console.log/warn/error`
- `debugger` statements
- Debug code left in tests

**Why:** Clutters test output and slows debugging

### 6. **Real Data Anti-patterns** 🔒
- Real email addresses
- Real usernames (like `@RealPerson`)
- Non-example.com URLs

**Why:** Privacy concerns and potential data leaks

### 7. **File System Anti-patterns** 📁
- Unmocked `fs` operations
- Real file I/O in tests
- `process.cwd()` without mocking

**Why:** Tests become environment-dependent and slow

### 8. **Network Anti-patterns** 🌐
- Unmocked `fetch` calls
- Unmocked `axios` requests
- Real API calls in tests

**Why:** Tests become flaky and dependent on network

### 9. **Memory Leak Anti-patterns** 💾
- `setInterval` without `clearInterval`
- Event listeners without cleanup
- Unclosed resources

**Why:** Causes memory leaks and test failures

### 10. **Test Isolation Anti-patterns** 🔐
- Shared state between tests
- Variables not reset in `beforeEach`
- Test order dependencies

**Why:** Tests fail when run in different order

## Usage

### Manual Check
```bash
# Check staged files
node scripts/check-test-antipatterns.js

# Check all test files
node scripts/check-test-antipatterns.js --all
```

### Automatic Pre-commit Hook
```bash
# Install pre-commit hooks
./scripts/setup-pre-commit.sh

# Now anti-patterns are checked automatically before each commit
```

### Output Example
```
🔍 Checking for test anti-patterns...

📋 TIMEOUTS Issues:

  ❌ Errors:
    tests/unit/someTest.test.js:45
      Found setTimeout with duration > 5 seconds. Use fake timers instead.
      Found: setTimeout(() => resolve(), 30000)

  ⚠️  Warnings:
    tests/unit/otherTest.test.js:12
      Test timeout is too long. Keep test timeouts under 10 seconds.

📊 Summary:
  Errors: 1
  Warnings: 1
  Info: 0

❌ Pre-commit check failed! Fix errors before committing.
```

## Benefits

1. **Prevents Repeated Issues**: Catches patterns we've had to fix multiple times
2. **Maintains Code Quality**: Ensures consistent test practices
3. **Faster Test Suite**: Prevents slow tests from being added
4. **Better Security**: Catches potential data leaks
5. **Cleaner Output**: Prevents console spam in tests

## Configuration

The anti-patterns are defined in `/scripts/check-test-antipatterns.js` and can be customized:

- **Severity Levels**: `error` (blocks commit), `warning` (shows warning), `info` (informational)
- **Pattern Matching**: Uses regex to find problematic patterns
- **Context Awareness**: Checks if issues are properly handled (e.g., mocks are cleaned up)

## Adding New Anti-patterns

To add a new anti-pattern check:

```javascript
// In check-test-antipatterns.js
newCategory: [
  {
    pattern: /yourRegexPattern/g,
    check: (match, capture, fileContent) => {
      // Return true if this is a problem
      return !fileContent.includes('expectedFix');
    },
    message: 'Description of the problem and how to fix it',
    severity: 'error' // or 'warning' or 'info'
  }
]
```

## Related Documentation

- [Test Anti-patterns Guide](./TEST_ANTIPATTERNS_GUIDE.md) - Detailed examples and fixes
- [Preventing Long-Running Tests](./PREVENTING_LONG_RUNNING_TESTS.md) - Timeout-specific guidance
- [Test Helpers README](../helpers/README.md) - Utilities to avoid anti-patterns