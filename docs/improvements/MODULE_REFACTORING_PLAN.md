# Module Refactoring Plan

## Problem Statement

We have several large modules that have grown to do too much, as evidenced by:
- Multiple test files per module (e.g., aiService has 4 test files)
- Files exceeding 1500 lines (webhookManager has 2800+ lines!)
- Mixing multiple responsibilities in single modules
- Difficulty in understanding and maintaining the code

## Modules Requiring Refactoring

### 1. webhookManager.js (2800+ lines) → 11 test files
**Current Responsibilities:**
- Webhook creation and caching
- Message sending via webhooks
- Message splitting for Discord limits
- DM channel fallback handling
- Media processing (audio, images)
- Username formatting
- Avatar management
- Rate limit handling

**Proposed Refactoring:**
```
src/webhook/
├── WebhookManager.js (200 lines) - Core orchestrator
├── WebhookCache.js (150 lines) - Webhook caching logic
├── WebhookCreator.js (200 lines) - Webhook creation/validation
├── MessageSender.js (300 lines) - Sending messages via webhooks
├── MessageSplitter.js (200 lines) - Splitting long messages
├── DirectMessageHandler.js (150 lines) - DM channel fallback
├── MediaProcessor.js (250 lines) - Process media for webhooks
├── UserFormatter.js (150 lines) - Username/avatar formatting
└── RateLimitHandler.js (100 lines) - Handle rate limits
```

### 2. aiService.js (1700+ lines) → 4 test files
**Current Responsibilities:**
- AI API communication
- Request deduplication
- Message formatting
- Error detection
- Media extraction from embeds
- Reference message handling
- Blackout period management

**Proposed Refactoring:**
```
src/ai/
├── AIService.js (200 lines) - Core orchestrator
├── AIClient.js (300 lines) - API communication
├── RequestDeduplicator.js (150 lines) - Prevent duplicate requests
├── MessageFormatter.js (250 lines) - Format messages for AI
├── MediaExtractor.js (200 lines) - Extract media from embeds
├── ReferenceResolver.js (250 lines) - Handle message references
├── ErrorDetector.js (150 lines) - Detect AI errors
└── BlackoutManager.js (100 lines) - Manage blackout periods
```

### 3. bot.js (1000+ lines) → 14 test files
**Current Responsibilities:**
- Discord event handling
- Command processing
- Message handling
- Channel activation
- Mention processing
- Error filtering
- DM handling
- Reference handling

**Proposed Refactoring:**
```
src/bot/
├── Bot.js (200 lines) - Core Discord client
├── EventHandler.js (150 lines) - Discord event routing
├── CommandRouter.js (150 lines) - Route to command processor
├── MessageRouter.js (200 lines) - Route messages to handlers
├── ActivationManager.js (150 lines) - Channel activation
├── MentionProcessor.js (150 lines) - Process @mentions
└── ErrorFilter.js (100 lines) - Filter known errors
```

### 4. personalityManager.js (690 lines) → 4 test files
**Current Responsibilities:**
- Personality registration
- Alias management
- Persistence to disk
- Seeding initial personalities
- Validation

**Proposed Refactoring:**
```
src/personality/
├── PersonalityManager.js (150 lines) - Core orchestrator
├── PersonalityRegistry.js (150 lines) - Registration logic
├── AliasManager.js (100 lines) - Alias handling
├── PersonalityPersistence.js (100 lines) - Save/load from disk
├── PersonalitySeeder.js (100 lines) - Seed initial data
└── PersonalityValidator.js (90 lines) - Validation logic
```

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