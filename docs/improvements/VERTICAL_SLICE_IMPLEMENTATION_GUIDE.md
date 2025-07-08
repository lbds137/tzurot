# Vertical Slice Implementation Guide

## Overview

This guide provides a structured approach to completing the DDD migration using vertical slices. Each slice migrates one complete user flow from entry point to response, eliminating the architectural inconsistency between DDD and legacy patterns.

## Core Principle

**One Flow, One Slice, Complete Migration**

Each vertical slice should:
1. Take a specific user interaction
2. Route it through clean DDD architecture
3. Completely bypass legacy code for that flow
4. Delete or deprecate the legacy path

## Implementation Strategy

### Phase 1: Message Router Infrastructure (Prerequisites)

Before implementing any vertical slice, we need a clean routing layer:

```javascript
// src/core/MessageRouter.js
class MessageRouter {
  constructor({ legacyHandler, featureFlags, sliceHandlers }) {
    this.legacy = legacyHandler;
    this.flags = featureFlags;
    this.slices = new Map(sliceHandlers);
  }
  
  async route(message) {
    // Check each slice in priority order
    for (const [sliceName, handler] of this.slices) {
      if (this.flags.isEnabled(`ddd.slice.${sliceName}`) && 
          await handler.canHandle(message)) {
        return handler.handle(message);
      }
    }
    
    // Fallback to legacy
    return this.legacy.handle(message);
  }
}
```

**Implementation Steps:**
1. Create `MessageRouter` class
2. Update `messageHandler.js` to delegate to router
3. Add feature flags for each slice: `ddd.slice.{name}`
4. Test with all flags disabled (should behave identically)

### Phase 2: Vertical Slices (Priority Order)

## Slice 1: Direct Personality Mention Flow

**User Story:** "As a user, when I mention a personality by name, I want to get a response"

**Current Flow:**
```
Discord Message → messageHandler → checkForPersonalityMentions → 
personalityHandler → aiService → webhookManager → Discord
```

**Target Flow:**
```
Discord Message → MessageRouter → PersonalityMentionSlice → 
PersonalityDomain → AIServiceDomain → WebhookDomain → Discord
```

**Implementation Guide:**

1. **Create Slice Handler**
```javascript
// src/application/slices/PersonalityMentionSlice.js
class PersonalityMentionSlice {
  async canHandle(message) {
    // Extract from messageHandler.checkForPersonalityMentions
    return await this.hasPersonalityMention(message.content);
  }
  
  async handle(message) {
    // Clean DDD flow
    const mention = await this.extractMention(message);
    const personality = await this.personalityRepo.findByName(mention);
    const conversation = await this.conversationService.findOrCreate(message.channelId);
    
    const response = await this.aiService.generateResponse({
      personality,
      conversation,
      message
    });
    
    await this.webhookService.send({
      channel: message.channel,
      content: response.content,
      personality: personality
    });
    
    // Emit domain events
    this.eventBus.emit('PersonalityMentioned', { personality, message });
    this.eventBus.emit('ResponseGenerated', { response, conversation });
  }
}
```

2. **Extract Required Components**
   - Move mention detection logic from `messageHandler.js`
   - Create clean `PersonalityMentionParser`
   - Use existing DDD PersonalityRepository
   - Create simplified `WebhookService` (not manager)

3. **Feature Flag Rollout**
   - Start with `ddd.slice.personality-mention: false`
   - Test in development with flag enabled
   - Enable for specific test channels/guilds
   - Monitor for issues
   - Enable globally
   - Delete legacy code path

## Slice 2: Active Conversation Flow

**User Story:** "As a user in an active conversation, when I send a message, the bot should respond"

**Current Flow:**
```
Discord Message → messageHandler → isActiveConversation → 
conversationManager → personalityHandler → aiService → webhookManager
```

**Target Flow:**
```
Discord Message → MessageRouter → ActiveConversationSlice →
ConversationDomain → AIServiceDomain → WebhookDomain → Discord
```

**Implementation Steps:**
1. Create `ActiveConversationSlice` handler
2. Use DDD `ConversationRepository` 
3. Implement clean conversation state machine
4. Route through same AI and Webhook services as Slice 1

## Slice 3: Command Flow Enhancement

**User Story:** "Unify command handling with message flow"

**Note:** Commands are already DDD, but they bypass the message router

**Target Flow:**
```
Discord Message → MessageRouter → CommandSlice → 
CommandBus → CommandHandler → Domain Services
```

**Benefits:**
- Single entry point for all messages
- Consistent routing logic
- Easier debugging with correlation IDs

## Slice 4: Reply/Reference Flow

**User Story:** "As a user, when I reply to a message, include context"

**Current Flow:**
```
Discord Message → messageHandler → referenceHandler → 
fetchReferencedMessage → personalityHandler → aiService
```

**Target Flow:**
```
Discord Message → MessageRouter → ReplyContextSlice →
MessageReferenceService → ConversationDomain → AIServiceDomain
```

## Phase 3: Core Service Cleanup

Once all slices are migrated:

### 1. Delete `messageHandler.js` entirely
- All flows now go through MessageRouter
- No legacy code paths remain

### 2. Refactor `webhookManager.js` → `WebhookService.js`
```javascript
// From: 642 lines of mixed concerns
// To: Simple service with single responsibility
class WebhookService {
  async send({ channel, content, personality }) {
    const webhook = await this.cache.get(channel.id);
    return webhook.send({
      content,
      username: personality.displayName,
      avatarURL: personality.avatarUrl
    });
  }
}
```

### 3. Refactor `aiService.js` → Domain Service
- Move to `src/domain/ai/AIService.js`
- Remove request deduplication (handle at application layer)
- Focus on pure AI interaction

## Implementation Checklist

For each vertical slice:

- [ ] Create slice handler with `canHandle()` and `handle()`
- [ ] Extract necessary logic from legacy code
- [ ] Implement using domain models and services
- [ ] Add comprehensive tests
- [ ] Add feature flag `ddd.slice.{name}`
- [ ] Test with flag disabled (legacy path)
- [ ] Test with flag enabled (DDD path)
- [ ] Compare outputs between legacy and DDD
- [ ] Enable flag in production gradually
- [ ] Monitor for issues
- [ ] Delete legacy code once stable

## Success Metrics

1. **Code Reduction**
   - `messageHandler.js`: 706 → 0 lines
   - `webhookManager.js`: 642 → ~200 lines
   - `aiService.js`: 457 → ~200 lines

2. **Architectural Consistency**
   - 100% of message flows through DDD
   - No legacy patterns in core flow
   - Clear domain boundaries

3. **Developer Experience**
   - Single entry point for debugging
   - Consistent patterns throughout
   - Easy to add new flows

## Priority and Effort Estimates

| Slice | Priority | Effort | Impact |
|-------|----------|---------|---------|
| Message Router | Required | 1 week | Foundation |
| Personality Mention | High | 1 week | Most common flow |
| Active Conversation | High | 1 week | Core feature |
| Command Enhancement | Medium | 3 days | Consistency |
| Reply Context | Medium | 1 week | Feature completeness |
| Service Cleanup | High | 1 week | Debt removal |

**Total Timeline:** 6-7 weeks for complete migration

## Notes for Implementation

1. **Use Existing DDD Components**
   - Repositories are already created
   - Domain models exist
   - Event bus is ready
   - Don't recreate what's already there

2. **Feature Flags Are Your Friend**
   - Same pattern that worked for commands
   - Allows safe, gradual rollout
   - Easy rollback if issues

3. **Delete Aggressively**
   - Once a slice is stable, delete the legacy path
   - Don't maintain two versions
   - Clean as you go

4. **Test Behavior, Not Implementation**
   - Ensure DDD path produces same results
   - Use integration tests
   - Compare actual Discord outputs

This approach will systematically eliminate the architectural inconsistency while maintaining system stability throughout the migration.