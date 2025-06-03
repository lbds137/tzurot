# Module Refactoring Plan

**Last Updated**: June 3, 2025

## Problem Statement

We have several large modules that have grown to do too much, as evidenced by:
- Multiple test files per module (e.g., aiService has 4 test files)
- Files exceeding 500 lines (our agreed-upon limit)
- Mixing multiple responsibilities in single modules
- Difficulty in understanding and maintaining the code

## Current Status

### ✅ Successfully Refactored
- **bot.js**: Now only 79 lines (previously 1000+)
- **aiService.js**: Now 392 lines (previously 1700+)
- **personalityManager.js**: Now 282 lines (previously 690)

### 🔴 Modules Still Requiring Refactoring

### 1. personalityHandler.js (834 lines)
**Current Responsibilities:**
- Personality message handling
- Webhook coordination
- Response formatting
- Error handling for personality interactions

**Proposed Refactoring:**
```
src/handlers/personality/
├── PersonalityHandler.js (200 lines) - Core orchestrator
├── PersonalityMessageProcessor.js (200 lines) - Process incoming messages
├── PersonalityResponseFormatter.js (150 lines) - Format responses
├── PersonalityWebhookCoordinator.js (150 lines) - Coordinate with webhook manager
└── PersonalityErrorHandler.js (134 lines) - Handle personality-specific errors
```

### 2. messageHandler.js (692 lines)
**Current Responsibilities:**
- Message routing and processing
- Mention detection and parsing
- Command detection
- Channel activation checks
- Personality lookup
- Response coordination

**Proposed Refactoring:**
```
src/handlers/message/
├── MessageHandler.js (150 lines) - Core message router
├── MentionDetector.js (150 lines) - Detect and parse mentions
├── CommandDetector.js (100 lines) - Identify commands
├── ChannelActivationChecker.js (100 lines) - Check channel activation
├── PersonalityResolver.js (100 lines) - Resolve personality from mentions
└── ResponseCoordinator.js (92 lines) - Coordinate responses
```

### 3. webhookManager.js (638 lines)
**Current Responsibilities:**
- Webhook creation and caching
- Message sending via webhooks
- Message splitting for Discord limits
- DM channel fallback handling
- Avatar management
- Username formatting

**Proposed Refactoring:**
```
src/webhook/
├── WebhookManager.js (150 lines) - Core orchestrator
├── WebhookCache.js (100 lines) - Webhook caching logic
├── WebhookCreator.js (100 lines) - Webhook creation/validation
├── MessageSender.js (150 lines) - Sending messages via webhooks
├── MessageSplitter.js (100 lines) - Splitting long messages
└── DirectMessageHandler.js (38 lines) - DM channel fallback
```

### 4. referenceHandler.js (539 lines)
**Current Responsibilities:**
- Message reference handling
- Media extraction from referenced messages
- Embed processing
- Reference chain following
- Error handling for references

**Proposed Refactoring:**
```
src/handlers/reference/
├── ReferenceHandler.js (150 lines) - Core orchestrator
├── ReferenceResolver.js (100 lines) - Resolve message references
├── ReferenceMediaExtractor.js (100 lines) - Extract media from references
├── ReferenceEmbedProcessor.js (100 lines) - Process embeds in references
└── ReferenceChainResolver.js (89 lines) - Follow reference chains
```

### 🟡 Files Approaching Limit (Monitor Closely)
- **PersonalityManager.js**: 497 lines (core/personality/)
- **embedBuilders.js**: 496 lines (utils/)
- **aiMessageFormatter.js**: 481 lines (utils/)
- **webhookUserTracker.js**: 466 lines (utils/)
- **avatarManager.js**: 443 lines (utils/)
- **auth.js**: 439 lines (src/)

## Implementation Strategy

### Phase 1: Create New Structure (No Breaking Changes)
1. Create new directory structures
2. Extract logic into new focused modules
3. Have old modules delegate to new ones
4. Add comprehensive tests for new modules

### Phase 2: Migration
1. Update all imports to use new modules
2. Deprecate old large modules
3. Remove delegation code
4. Delete old modules

### Phase 3: Cleanup
1. Consolidate tests to one per module
2. Update documentation
3. Remove old test files

## Enforcement Rules

### 1. File Size Limits
```javascript
// .eslintrc.js addition
module.exports = {
  rules: {
    'max-lines': ['error', {
      max: 500,
      skipBlankLines: true,
      skipComments: true
    }],
    'max-lines-per-function': ['error', {
      max: 50,
      skipBlankLines: true,
      skipComments: true
    }]
  }
};
```

### 2. Complexity Limits
```javascript
// .eslintrc.js addition
module.exports = {
  rules: {
    'complexity': ['error', 10], // Cyclomatic complexity
    'max-depth': ['error', 3],   // Max nesting depth
    'max-params': ['error', 4],  // Max function parameters
  }
};
```

### 3. Pre-commit Hook
```bash
#!/bin/bash
# scripts/check-module-size.sh

# Check for files over 500 lines
find src -name "*.js" -type f | while read file; do
  lines=$(wc -l < "$file")
  if [ $lines -gt 500 ]; then
    echo "ERROR: $file has $lines lines (max 500)"
    echo "Consider breaking it into smaller modules"
    exit 1
  fi
done

# Check for multiple test files per module
for src_file in src/**/*.js; do
  base_name=$(basename "$src_file" .js)
  test_count=$(find tests -name "${base_name}*.test.js" | wc -l)
  if [ $test_count -gt 1 ]; then
    echo "WARNING: $src_file has $test_count test files"
    echo "This suggests the module is doing too much"
  fi
done
```

### 4. CI/CD Enforcement
```yaml
# .github/workflows/code-quality.yml
- name: Check module sizes
  run: |
    npm run check:module-size
    npm run check:complexity
```

### 5. Documentation Requirements
Add to CONTRIBUTING.md:
```markdown
## Module Design Guidelines

1. **Single Responsibility**: Each module should have ONE clear purpose
2. **Size Limits**: Keep modules under 500 lines
3. **Test Organization**: One test file per module
4. **Dependency Injection**: Make external dependencies injectable
5. **Clear Interfaces**: Define clear public APIs

If you find yourself creating multiple test files for one module, STOP and refactor the module first.
```

## Benefits

1. **Maintainability**: Smaller, focused modules are easier to understand
2. **Testability**: Each module can be tested in isolation
3. **Reusability**: Focused modules can be reused more easily
4. **Performance**: Smaller modules load faster
5. **Onboarding**: New developers can understand the codebase faster

## Metrics for Success

- No module over 500 lines
- One test file per module
- Average cyclomatic complexity < 10
- Test execution time < 20 seconds
- 90%+ test coverage maintained