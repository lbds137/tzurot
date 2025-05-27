# Timer Pattern Enforcement Guide

This guide outlines the processes and tools in place to prevent timer-related testing issues from recurring in the Tzurot codebase.

## 🛡️ Prevention Strategies

### 1. Automated Timer Pattern Detection

We have a script that detects problematic timer patterns:

```bash
node scripts/check-timer-patterns.js
```

This script checks for:
- Promise-wrapped setTimeout (hard to test)
- Direct setTimeout usage in async functions
- setInterval without proper cleanup

**Run this script:**
- Before committing new code
- As part of PR reviews
- In CI/CD pipeline (recommended)

### 2. Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Check for timer patterns
node scripts/check-timer-patterns.js
if [ $? -ne 0 ]; then
  echo "❌ Timer pattern issues detected. Please fix before committing."
  exit 1
fi
```

### 3. CI/CD Integration

Add to your CI configuration (e.g., `.github/workflows/ci.yml`):

```yaml
- name: Check Timer Patterns
  run: node scripts/check-timer-patterns.js
```

## ✅ Best Practices

### For New Code

#### Classes
```javascript
class MyComponent {
  constructor(options = {}) {
    // ALWAYS make timers injectable
    this.scheduler = options.scheduler || setTimeout;
    this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  }
  
  async doSomething() {
    // Use the injectable timer
    await this.delay(1000);
  }
}
```

#### Modules
```javascript
// At module level
let delayFn = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function setDelayFunction(fn) {
  delayFn = fn;
}

// In functions
async function myFunction() {
  await delayFn(1000);
}

module.exports = { myFunction, setDelayFunction };
```

#### Commands
```javascript
async function execute(message, args, context = {}) {
  const { scheduler = setTimeout } = context;
  
  // Use injectable timer
  scheduler(() => cleanup(), 60000);
}
```

### For Tests

```javascript
// Always provide mock timers
const mockDelay = jest.fn().mockResolvedValue(undefined);
const mockScheduler = jest.fn();

// For classes
const instance = new MyComponent({
  delay: mockDelay,
  scheduler: mockScheduler
});

// For commands
await command.execute(message, args, {
  scheduler: mockScheduler,
  delay: mockDelay
});

// Verify timer usage
expect(mockScheduler).toHaveBeenCalledWith(
  expect.any(Function),
  60000
);
```

## 🚫 Anti-patterns to Avoid

### ❌ Direct Timer Usage
```javascript
// BAD - Not testable
async function badFunction() {
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

### ❌ Hard-coded Timers in Classes
```javascript
// BAD - Forces real timers in tests
class BadComponent {
  async wait() {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

### ❌ Global Timer Usage in Modules
```javascript
// BAD - Can't be mocked for tests
function scheduleCleanup() {
  setInterval(() => cleanup(), 60000);
}
```

## 📋 Code Review Checklist

When reviewing PRs, check for:

- [ ] All `setTimeout` calls are injectable
- [ ] All `setInterval` calls are injectable
- [ ] Promise-wrapped timers use injectable delays
- [ ] Tests provide mock timers, not real ones
- [ ] No `jest.useFakeTimers()` without proper setup
- [ ] Timer IDs are stored for cleanup

## 🔧 Fixing Violations

When the timer checker finds issues:

1. **Identify the pattern type**
   ```bash
   node scripts/check-timer-patterns.js
   ```

2. **Apply the appropriate fix**:
   - For Promise delays → Use injectable delay function
   - For setTimeout → Use injectable scheduler
   - For setInterval → Use injectable interval function

3. **Update tests** to use mock timers

4. **Verify the fix**:
   ```bash
   npm test path/to/affected/test.js
   ```

## 📊 Monitoring

### Regular Audits

Run monthly audits to ensure compliance:

```bash
# Full timer pattern audit
node scripts/check-timer-patterns.js > timer-audit.log

# Check test execution times (should be fast)
npm test -- --verbose 2>&1 | grep "Time:"
```

### Metrics to Track

1. **Timer Pattern Violations**: Should be 0
2. **Test Execution Time**: Should be < 30s for full suite
3. **Flaky Test Count**: Should be 0 for timer-related tests

## 🎯 Goals

- **Zero timer-related test failures**
- **All async delays are injectable**
- **Tests run instantly** (no real waiting)
- **100% timer pattern compliance**

## 📚 Resources

- [Timer Patterns Documentation](/docs/core/TIMER_PATTERNS.md)
- [Timer Testing Guide](/docs/testing/TIMER_TESTING_GUIDE.md)
- [Command Architecture](/docs/core/COMMAND_ARCHITECTURE.md)
- [Refactoring Summary](/docs/core/TIMER_REFACTORING_SUMMARY.md)

## 🚀 Future Improvements

1. **Enhanced Detection**
   - Add ESLint rule for timer patterns
   - Create VSCode snippets for correct patterns

2. **Automated Fixes**
   - Script to auto-convert simple timer patterns
   - Codemod for complex refactoring

3. **Developer Experience**
   - IDE warnings for anti-patterns
   - Quick-fix suggestions

By following this guide and using our enforcement tools, we can ensure timer-related testing issues never plague our codebase again!