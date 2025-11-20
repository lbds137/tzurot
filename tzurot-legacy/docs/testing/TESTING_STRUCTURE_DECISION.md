# Testing Structure Decision

## Decision: Hybrid Approach ✅

After consulting with Gemini, we're adopting a **hybrid approach** that combines the best of both worlds:
- **Mirror source structure** for findability
- **Filename suffixes** for test type clarity

## Final Structure

```
tests/
├── factories/                          # Shared mock factories
│   ├── discord.factory.js
│   ├── message.factory.js
│   └── index.js
│
├── handlers/                           # Mirrors src/handlers/
│   ├── messageHandler.unit.test.js    # Pure logic tests
│   ├── messageHandler.service.test.js # With mocked Discord objects
│   ├── personalityHandler.service.test.js
│   └── dmHandler.service.test.js
│
├── utils/                              # Mirrors src/utils/
│   ├── aiMessageFormatter.unit.test.js
│   ├── aiMessageFormatter.service.test.js
│   ├── aiMessageFormatter.snapshot.test.js  # Golden master
│   ├── contextMetadataFormatter.unit.test.js
│   └── messageSplitting.unit.test.js
│
├── commands/                           # Mirrors src/commands/
│   ├── info.service.test.js
│   ├── add.service.test.js
│   └── help.service.test.js
│
├── webhookManager/                     # Mirrors src/ structure
│   ├── webhookManager.service.test.js
│   └── webhookManager.snapshot.test.js
│
├── aiService/                          # Mirrors src/
│   ├── aiService.service.test.js
│   └── aiService.integration.test.js  # If we add API tests later
│
└── e2e/                                # Cross-cutting tests
    ├── formatting-pipeline.snapshot.test.js
    └── command-flow.service.test.js
```

## Test Type Suffixes

### `.unit.test.js`
- **Pure functions only**
- No Discord.js imports
- No mocking required
- Fast execution (< 10ms)
- Example: parsing utilities, formatters

### `.service.test.js`
- **Component/service layer tests**
- Uses mocked Discord objects from factories
- Tests single component in isolation
- Medium speed (< 100ms)
- Example: command handlers, message handlers

### `.snapshot.test.js`
- **Golden master tests**
- Captures output for regression detection
- Used heavily during refactoring
- Example: formatting pipeline output

### `.integration.test.js`
- **Multi-component tests** (rare for us)
- Tests interaction between components
- May use real file I/O or databases
- Slower execution
- Example: full command flow with persistence

### `.e2e.test.js`
- **End-to-end tests** (manual for Discord bots)
- Would test against real Discord (we don't do this)
- Reserved for future if we add test bot infrastructure

## Running Tests by Type

```bash
# Run all unit tests across entire project
npm test -- --testMatch="**/*.unit.test.js"

# Run all service tests
npm test -- --testMatch="**/*.service.test.js"

# Run all snapshot tests
npm test -- --testMatch="**/*.snapshot.test.js"

# Run all tests for a specific component
npm test tests/handlers/

# Run only unit tests for handlers
npm test -- --testMatch="**/handlers/*.unit.test.js"

# Update snapshots after verifying changes
npm test -- --testMatch="**/*.snapshot.test.js" -u
```

## NPM Scripts to Add

```json
{
  "scripts": {
    "test:unit": "jest --testMatch='**/*.unit.test.js'",
    "test:service": "jest --testMatch='**/*.service.test.js'",
    "test:snapshot": "jest --testMatch='**/*.snapshot.test.js'",
    "test:snapshot:update": "jest --testMatch='**/*.snapshot.test.js' -u",
    "test:handlers": "jest tests/handlers",
    "test:utils": "jest tests/utils",
    "test:commands": "jest tests/commands"
  }
}
```

## Migration Strategy for Existing Tests

### Step 1: Analyze Current Tests
```bash
# Create inventory of what we have
ls tests/unit/*.test.js | wc -l  # Count total files
grep -l "discord.js" tests/unit/*.test.js | wc -l  # Count service tests
grep -L "discord.js" tests/unit/*.test.js | wc -l  # Count true unit tests
```

### Step 2: Categorize Tests
1. **True Unit Tests** (no Discord imports) → `.unit.test.js`
2. **Service Tests** (mock Discord objects) → `.service.test.js`
3. **Snapshot Tests** (if any exist) → `.snapshot.test.js`

### Step 3: Create Directory Structure
```bash
# Create mirrored directories
mkdir -p tests/{handlers,utils,commands,core,adapters,application,domain}
mkdir -p tests/{webhookManager,aiService}
mkdir -p tests/e2e
```

### Step 4: Move and Rename Files
```bash
# Example migrations
mv tests/unit/messageHandler.test.js tests/handlers/messageHandler.service.test.js
mv tests/unit/aiMessageFormatter.test.js tests/utils/aiMessageFormatter.service.test.js
mv tests/unit/contextMetadataFormatter.test.js tests/utils/contextMetadataFormatter.unit.test.js
```

## Benefits of This Approach

### ✅ Findability
- Working on `src/handlers/messageHandler.js`?
- Tests are in `tests/handlers/messageHandler.*.test.js`
- No searching required!

### ✅ Clear Test Scope
- See `.unit.test.js`? It's fast and pure
- See `.service.test.js`? It uses mocks
- See `.snapshot.test.js`? It's a golden master

### ✅ Flexible Test Execution
- Run all unit tests for speed
- Run service tests for confidence
- Run snapshots before refactoring
- Run by directory for focused testing

### ✅ Scalable Structure
- Adding new source file? Mirror it in tests/
- Need different test types? Add more suffixes
- Structure grows naturally with codebase

## Examples

### Unit Test Example
```javascript
// tests/utils/messageSplitting.unit.test.js
const { splitMessage } = require('../../src/utils/messageSplitting');

describe('splitMessage', () => {
  test('returns single chunk for short message', () => {
    const result = splitMessage('Hello world');
    expect(result).toEqual(['Hello world']);
  });
  
  test('splits at 2000 characters', () => {
    const longMessage = 'a'.repeat(2001);
    const result = splitMessage(longMessage);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(2000);
  });
});
```

### Service Test Example
```javascript
// tests/handlers/messageHandler.service.test.js
const { MessageFactory } = require('../factories');
const { handleMessage } = require('../../src/handlers/messageHandler');

describe('messageHandler', () => {
  test('processes personality mention', async () => {
    const message = new MessageFactory()
      .withContent('@claude hello')
      .inGuild({ name: 'Test Server' })
      .build();
    
    await handleMessage(message);
    
    // Assert webhook was called, etc
  });
});
```

### Snapshot Test Example
```javascript
// tests/utils/aiMessageFormatter.snapshot.test.js
const { MessageFactory } = require('../factories');
const { formatApiMessages } = require('../../src/utils/aiMessageFormatter');

describe('aiMessageFormatter snapshots', () => {
  test('formats standard message', () => {
    const message = new MessageFactory()
      .withContent('Hello @claude')
      .withAttachment('http://example.com/image.png')
      .build();
    
    const result = formatApiMessages(message);
    
    expect(result).toMatchSnapshot();
  });
});
```

## Decision Rationale

1. **250+ test files** need organization → mirroring provides natural structure
2. **Mixed test types** in current structure → suffixes clarify intent
3. **Need to run subsets** for CI/CD → glob patterns make this easy
4. **Refactoring safety** needed → snapshot tests in same location as code
5. **Developer experience** matters → finding tests should be instant

## Next Steps

1. [ ] Create factories directory with Discord mocks
2. [ ] Create directory structure mirroring src/
3. [ ] Write script to categorize existing tests
4. [ ] Move and rename test files with proper suffixes
5. [ ] Update package.json with new test scripts
6. [ ] Create golden master tests for formatting pipeline