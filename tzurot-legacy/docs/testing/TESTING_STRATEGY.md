# Testing Strategy for Tzurot Bot

## Overview
Based on Gemini's recommendations, we're implementing a practical testing pyramid adapted for Discord bots where true integration testing is difficult.

## Testing Pyramid (Adapted for Discord Bots)

```
      /------------------\
     |   Manual Staging   |  (Very Few - Sanity checks on test server)
    /----------------------\
   |  Golden Master Tests  |  (Critical for formatting refactor)
  /------------------------\
 | Service/Component Tests  | (Bulk of tests - mocked Discord objects)
/--------------------------\
|      Unit Tests          | (Pure logic - no Discord dependencies)
----------------------------
```

## Current State Analysis

### What We Have
- **250+ test files** all in `/tests/unit/`
- Mix of actual unit tests and integration tests
- Some tests mock Discord objects, others test pure functions
- No clear organization or separation of concerns

### Problems
1. Can't tell test scope from location
2. Some "unit" tests are actually service tests
3. No snapshot/golden master tests for critical paths
4. Mock creation is inconsistent and scattered

## Proposed Test Organization

```
tests/
├── __mocks__/           # Jest auto-mocks
├── factories/           # Discord object mock factories
│   ├── index.js
│   ├── message.factory.js
│   ├── guild.factory.js
│   ├── channel.factory.js
│   ├── user.factory.js
│   └── webhook.factory.js
├── unit/               # Pure functions, no Discord.js imports
│   ├── utils/          # Utility function tests
│   └── domain/         # Domain logic tests
├── service/            # Component tests with mocked Discord
│   ├── commands/       # Command handler tests
│   ├── handlers/       # Message handler tests
│   └── formatting/     # Formatting pipeline tests
└── snapshots/          # Golden master tests
    └── formatting/     # Message formatting snapshots
```

## Test Categories

### 1. Unit Tests (Fast, Isolated)
**Location**: `tests/unit/`
**Characteristics**:
- No Discord.js imports
- Test pure functions only
- No mocking needed
- Run in < 10ms each

**Examples**:
- Text parsing utilities
- Time formatting functions
- Configuration validators
- Pure domain logic

### 2. Service/Component Tests (Mocked Discord)
**Location**: `tests/service/`
**Characteristics**:
- Test interaction with Discord objects
- Use mock factories for Discord objects
- Test single service/component in isolation
- Mock external dependencies

**Examples**:
- Command handlers with mock messages
- Permission checks with mock members
- Webhook formatting with mock data
- Message handlers with mock channels

### 3. Golden Master/Snapshot Tests (Output Verification)
**Location**: `tests/snapshots/`
**Characteristics**:
- Test entire pipelines end-to-end
- Compare output against saved snapshots
- Perfect for refactoring safety
- Catch unexpected changes

**Examples**:
- Complete formatting pipeline output
- Webhook payload generation
- Embed builder output
- Complex message transformations

### 4. Manual Staging Tests
**Location**: Private test Discord server
**Characteristics**:
- Real Discord API interaction
- Manual verification needed
- Only for critical paths
- Before major releases

**Examples**:
- New Discord.js version compatibility
- Permission system changes
- Webhook functionality
- Rate limit handling

## Mock Factory Design

### Core Principles
1. **Composable**: Factories use other factories
2. **Fluent API**: Chainable builder pattern
3. **Type-safe**: Full TypeScript types (we'll adapt for JS)
4. **Realistic**: Match Discord.js v14 structure

### Factory Structure

```javascript
// tests/factories/message.factory.js
class MessageFactory {
  constructor() {
    this.message = {
      id: '123456789',
      content: 'default content',
      author: createMockUser(),
      member: createMockMember(),
      guild: createMockGuild(),
      channel: createMockChannel(),
      attachments: new Map(),
      embeds: [],
      reply: jest.fn(),
      delete: jest.fn()
    };
  }

  withContent(content) {
    this.message.content = content;
    return this;
  }

  fromUser(userOverrides) {
    this.message.author = createMockUser(userOverrides);
    return this;
  }

  inChannel(channelOverrides) {
    this.message.channel = createMockChannel(channelOverrides);
    return this;
  }

  asDM() {
    this.message.guild = null;
    this.message.member = null;
    this.message.channel.type = 'DM';
    return this;
  }

  asThread() {
    this.message.channel.type = 'GUILD_PUBLIC_THREAD';
    this.message.channel.parent = createMockChannel();
    return this;
  }

  asWebhook(webhookData) {
    this.message.webhookId = '987654321';
    this.message.author.bot = true;
    this.message.member = null;
    return this;
  }

  withAttachment(url, contentType = 'image/png') {
    const attachment = {
      id: '111111',
      url: url,
      contentType: contentType,
      name: 'file.png',
      size: 1024
    };
    this.message.attachments.set(attachment.id, attachment);
    return this;
  }

  asReplyTo(originalMessage) {
    this.message.reference = {
      messageId: originalMessage.id,
      channelId: originalMessage.channel.id,
      guildId: originalMessage.guild?.id
    };
    this.message.fetchReference = jest.fn().mockResolvedValue(originalMessage);
    return this;
  }

  build() {
    // Return a deep clone to prevent test interference
    return JSON.parse(JSON.stringify(this.message));
  }
}

// Preset factories for common scenarios
const Factories = {
  // Standard guild message
  createGuildMessage: (content) => 
    new MessageFactory().withContent(content).build(),
  
  // DM message
  createDMMessage: (content) => 
    new MessageFactory().withContent(content).asDM().build(),
  
  // Thread message
  createThreadMessage: (content) => 
    new MessageFactory().withContent(content).asThread().build(),
  
  // PluralKit/webhook message
  createWebhookMessage: (content, username) => 
    new MessageFactory()
      .withContent(content)
      .asWebhook()
      .fromUser({ username, bot: true })
      .build(),
  
  // Message with media
  createMediaMessage: (content, attachmentUrl) =>
    new MessageFactory()
      .withContent(content)
      .withAttachment(attachmentUrl)
      .build()
};
```

## Golden Master Test Strategy

### Phase 1: Capture Current Behavior
1. Create comprehensive test cases covering all formatting scenarios
2. Run against current (working) code
3. Save outputs as snapshots
4. Manually review snapshots for correctness

### Test Scenarios to Cover
```javascript
// tests/snapshots/formatting-pipeline.test.js
describe('Message Formatting Pipeline - Golden Masters', () => {
  // Basic scenarios
  test('simple text message');
  test('message with emoji');
  test('message with @mention');
  test('message with multiple mentions');
  
  // Context metadata
  test('message with context metadata enabled');
  test('DM without context metadata');
  test('thread with parent context');
  
  // Long messages
  test('message at 1999 characters');
  test('message at 2001 characters (needs split)');
  test('message with code block crossing split boundary');
  
  // Special cases
  test('webhook message from PluralKit');
  test('reply with referenced content');
  test('message with attachments');
  test('message with model indicator');
  
  // Edge cases
  test('empty message');
  test('whitespace-only message');
  test('message with only mentions');
  test('message with Discord markdown');
});
```

### Phase 2: Refactor with Confidence
1. Run golden master tests before any change
2. Make refactoring changes
3. Run tests again - any differences will be highlighted
4. If difference is intentional, update snapshot
5. If unintentional, fix the bug

## Migration Plan

### Step 1: Create Factory Infrastructure (2 hours)
- [ ] Create `tests/factories/` directory
- [ ] Implement core factories (Message, User, Guild, Channel)
- [ ] Create factory presets for common scenarios
- [ ] Document factory usage patterns

### Step 2: Create Golden Master Tests (3 hours)
- [ ] Identify all formatting code paths
- [ ] Create comprehensive test scenarios
- [ ] Generate initial snapshots
- [ ] Manually verify snapshot correctness

### Step 3: Reorganize Existing Tests (4 hours)
- [ ] Create new directory structure
- [ ] Categorize existing tests (unit vs service)
- [ ] Move tests to appropriate directories
- [ ] Update imports and paths

### Step 4: Refactor with Safety Net (ongoing)
- [ ] Run golden master tests before changes
- [ ] Make incremental refactoring changes
- [ ] Verify tests still pass
- [ ] Update snapshots only for intentional changes

## Success Metrics

1. **Test Organization**: Clear separation between test types
2. **Factory Usage**: Consistent mock creation across all tests
3. **Golden Masters**: 100% coverage of formatting paths
4. **Refactoring Safety**: Zero unintended behavior changes
5. **Test Speed**: Unit tests < 10ms, Service tests < 100ms

## Tools and Commands

### Running Specific Test Types
```bash
# Run only unit tests
npm test tests/unit

# Run only service tests  
npm test tests/service

# Run golden master tests
npm test tests/snapshots

# Update snapshots (after verifying changes)
npm test tests/snapshots -- -u

# Run tests in watch mode
npm test -- --watch
```

### Coverage by Type
```bash
# Coverage for unit tests only
npm test tests/unit -- --coverage

# Coverage for service layer
npm test tests/service -- --coverage
```

## Common Patterns

### Testing Commands
```javascript
// tests/service/commands/info.test.js
const { Factories } = require('../../factories');
const { handleInfoCommand } = require('../../../src/commands/info');

describe('Info Command', () => {
  test('shows personality info for valid name', async () => {
    const message = Factories.createGuildMessage('!tz info claude');
    const response = await handleInfoCommand(message);
    
    expect(response.embed).toBeDefined();
    expect(response.embed.title).toBe('Claude');
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.any(Object)]
    }));
  });
});
```

### Testing Formatters
```javascript
// tests/service/formatting/context.test.js
const { Factories } = require('../../factories');
const { formatContextMetadata } = require('../../../src/utils/contextMetadataFormatter');

describe('Context Metadata Formatter', () => {
  test('formats guild message context', () => {
    const message = Factories.createGuildMessage('test');
    message.guild.name = 'Test Server';
    message.channel.name = 'general';
    
    const result = formatContextMetadata(message);
    
    expect(result).toBe('[Discord: Test Server > #general | 2024-...]');
  });
  
  test('returns empty string for DMs', () => {
    const message = Factories.createDMMessage('test');
    const result = formatContextMetadata(message);
    expect(result).toBe('');
  });
});
```

## Notes

- Start with golden master tests BEFORE refactoring
- Use factories consistently - no ad-hoc mocks
- Keep unit tests pure - no mocking needed
- Service tests should test one component
- Manual staging is a last resort safety check