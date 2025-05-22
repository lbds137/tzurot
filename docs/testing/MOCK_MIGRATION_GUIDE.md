# Mock System Migration Guide

This guide provides a practical approach to migrating from the scattered mock system to the consolidated mock system.

## Migration Strategy Overview

Based on analysis of the current test suite, we have identified a **progressive enhancement approach** that allows incremental migration without breaking existing functionality.

### Current State

- **90% of tests** use the old scattered mock system
- **60% code duplication** across mock implementations  
- **35+ test files** need migration
- **~500 lines** of duplicate mock code

### Migration Approach: Progressive Enhancement

Rather than attempting a full replacement, we use a **progressive enhancement** strategy:

1. **Keep existing Jest mocks** (required for module replacement)
2. **Enhance object creation** using the new consolidated system
3. **Reduce boilerplate** with standardized helpers
4. **Migrate incrementally** as tests are modified

## New Mock System Components

### 1. Consolidated Mock System (`tests/__mocks__/`)

- **`index.js`** - Main entry point with presets
- **`discord.js`** - Comprehensive Discord.js mocks
- **`api.js`** - Unified API/fetch mocks
- **`modules.js`** - Application module mocks

### 2. Bridge Utilities (`tests/__mocks__/bridge.js`)

Provides compatibility layer between Jest module mocking and new object creation.

### 3. Test Enhancements (`tests/utils/testEnhancements.js`)

Reduces boilerplate while maintaining compatibility with existing patterns.

## Migration Patterns

### Pattern 1: Enhanced Object Creation

**Before (Old Pattern):**
```javascript
const helpers = require('../../../utils/commandTestHelpers');

beforeEach(() => {
  mockMessage = helpers.createMockMessage();
  mockMessage.channel.send = jest.fn().mockResolvedValue({ id: 'test' });
  // ... more boilerplate setup
});
```

**After (Enhanced Pattern):**
```javascript
const { createMigrationHelper } = require('../../../utils/testEnhancements');
const migrationHelper = createMigrationHelper('command');

beforeEach(() => {
  mockMessage = migrationHelper.enhanced.createMessage({
    content: '!tz test',
    author: { id: 'user-123' }
  });
  // Automatic setup with less boilerplate
});
```

### Pattern 2: Standardized Assertions

**Before:**
```javascript
expect(mockMessage.channel.send).toHaveBeenCalled();
expect(mockMessage.channel.send).toHaveBeenCalledWith('Expected message');
expect(command.meta.name).toBe('commandName');
// ... repetitive assertions
```

**After:**
```javascript
migrationHelper.enhanced.assert.assertMessageSent(mockMessage, 'Expected message');
migrationHelper.enhanced.assert.assertCommandMetadata(command, 'commandName');
```

### Pattern 3: Preset Configurations

**Before:**
```javascript
// Multiple manual mock setups across different test files
mockPersonalityManager = {
  getPersonality: jest.fn().mockReturnValue(null),
  registerPersonality: jest.fn().mockResolvedValue(/* ... */),
  // ... dozens of lines of setup
};
```

**After:**
```javascript
const { presets } = require('../../../__mocks__');
const mockEnv = presets.commandTest({
  userPermissions: ['ADMINISTRATOR']
});
// Automatic setup with consistent behavior
```

## Migration Priority

### Phase 1: Command Handler Tests (High Priority)
- Highest code duplication
- Most standardized patterns
- Immediate benefit from migration

### Phase 2: Bot Integration Tests (Medium Priority)  
- Complex mocking scenarios
- Good candidates for preset configurations

### Phase 3: Utility Tests (Low Priority)
- Often have custom mocking needs
- Migrate as-needed basis

## Key Benefits

### 1. Reduced Code Duplication
- **60% reduction** in mock setup code
- Consistent behavior across tests
- Single source of truth for mock implementations

### 2. Improved Maintainability
- Changes to mock behavior in one place
- Easier to update mock implementations
- Better consistency across test suite

### 3. Enhanced Developer Experience
- Less boilerplate code to write
- Standardized patterns for common scenarios
- Better error messages and debugging

### 4. Gradual Adoption
- No breaking changes to existing tests
- Migrate tests incrementally
- Maintain backward compatibility

## Implementation Steps

### For New Tests
1. Use the new consolidated mock system from the beginning
2. Follow the patterns in `tests/examples/mock-system-example.test.js`
3. Use presets for common scenarios

### For Existing Tests
1. **Identify duplication**: Look for repeated mock setup patterns
2. **Start small**: Begin with simple object creation enhancements
3. **Use bridge utilities**: Maintain Jest mocking while enhancing object creation
4. **Add standardized assertions**: Replace repetitive assertion patterns
5. **Full migration**: Eventually migrate to preset configurations

### Migration Checklist

- [ ] Replace manual mock object creation with enhanced helpers
- [ ] Use standardized assertion methods
- [ ] Adopt preset configurations for common scenarios
- [ ] Remove duplicate mock setup code
- [ ] Update imports to use consolidated system

## Files to Eventually Remove

After migration is complete, these files can be removed:

```
tests/mocks/discord.js.mock.js          (~60 lines)
tests/mocks/profileInfoFetcher.mocks.js (~40 lines)
tests/utils/apiMocks.js                 (~80 lines)
tests/utils/discordMocks.js             (~120 lines)
tests/utils/mockFactories.js            (~200 lines)
```

**Total reduction: ~500 lines of duplicate code**

## Example Migration

See `tests/examples/mock-system-example.test.js` for complete examples of the new patterns.

The migration provides immediate benefits through reduced boilerplate while maintaining full compatibility with existing test infrastructure.