# New Code Development Checklist

This checklist MUST be followed when creating new files or significant new functionality. It serves as a guardrail to ensure we don't repeat past mistakes.

## Pre-Development Checklist

Before writing any code:

- [ ] Review existing patterns in similar files
- [ ] Check if functionality already exists elsewhere
- [ ] Ensure you're following DDD principles if applicable
- [ ] Plan for testability from the start

## Code Structure Requirements

### 1. Injectable Dependencies ✅

All external dependencies MUST be injectable:

```javascript
// ✅ CORRECT
class MyService {
  constructor(options = {}) {
    this.delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.setInterval = options.setInterval || setInterval;
    this.clearInterval = options.clearInterval || clearInterval;
    this.fetch = options.fetch || require('node-fetch');
    this.logger = options.logger || require('./logger');
  }
}

// ❌ WRONG
class MyService {
  constructor() {
    // Hard-coded dependencies make testing difficult
  }

  async doSomething() {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Not injectable!
  }
}
```

### 2. Timer Patterns ⏱️

**NEVER use timers directly**:

- [ ] All `setTimeout` calls must be injectable
- [ ] All `setInterval` calls must be injectable
- [ ] Intervals must have cleanup methods
- [ ] Consider using `unref()` on intervals

### 3. File Size Limits 📏

- [ ] Target: < 500 lines
- [ ] Maximum: < 1000 lines (linter will warn)
- [ ] If approaching limit, refactor into multiple modules

### 4. Error Handling 🚨

- [ ] All async operations wrapped in try/catch
- [ ] Errors logged with context
- [ ] User-friendly error messages
- [ ] No error swallowing

### 5. Testing Requirements 🧪

- [ ] Write tests BEFORE or WITH implementation
- [ ] Mock all external dependencies
- [ ] Use fake timers for any time-based logic
- [ ] Test both success and error paths
- [ ] Tests must run in < 500ms

## DDD-Specific Requirements

When creating domain models or adapters:

### Domain Models

- [ ] Extend appropriate base class (AggregateRoot, ValueObject, etc.)
- [ ] Emit domain events for state changes
- [ ] No external dependencies in domain layer
- [ ] Immutable value objects

### Repository Adapters

- [ ] Implement domain repository interface
- [ ] Handle persistence errors gracefully
- [ ] Include shutdown/cleanup methods
- [ ] Make all I/O operations injectable

### Application Services

- [ ] Orchestrate domain operations only
- [ ] No business logic (belongs in domain)
- [ ] Handle cross-cutting concerns
- [ ] Emit integration events if needed

## Pre-Commit Checklist

Before committing:

- [ ] Run `npm run lint:timers` - Fix any errors
- [ ] Run `npm test` - All tests pass
- [ ] Run `npm run lint` - No linting errors
- [ ] Check file sizes with `npm run lint:module-size`
- [ ] Update tests if behavior changed
- [ ] Add new patterns to this checklist if discovered

## Common Pitfalls to Avoid

1. **Hardcoded delays**: Always make them injectable
2. **Direct file I/O**: Use injectable fs operations
3. **Singleton exports**: Export classes/factories, not instances
4. **Missing cleanup**: Always provide shutdown methods
5. **Tight coupling**: Use dependency injection
6. **Large files**: Split early, split often

## Enforcement

These patterns are enforced by:

- Pre-commit hooks
- CI/CD pipeline
- Code review process
- Automated linting

## Examples of Good Patterns

See these files for reference:

- Injectable timers: `src/utils/rateLimiter.js`
- Clean domain model: `src/domain/personality/Personality.js`
- Good adapter: `src/adapters/discord/DiscordMessageAdapter.js`
- Proper testing: `tests/unit/domain/personality/Personality.test.js`

## Remember

> "Every line of code is a liability. Make each one count."

The goal is maintainable, testable code that follows established patterns. When in doubt, ask for review before implementing.
