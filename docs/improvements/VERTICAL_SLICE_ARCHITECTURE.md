# Vertical Slice Architecture Diagrams

## Current State: The Hybrid Mess

```
┌─────────────────────────────────────────────────────────┐
│                   Discord Message                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              messageHandler.js (706 lines)               │
│  - Command detection → Routes to DDD ────────┐          │
│  - Personality mentions ← Legacy ──┐         │          │
│  - Active conversations ← Legacy ──┤         │          │
│  - Reply handling ← Legacy ────────┘         │          │
└─────────────────────┬───────────────────────┴──────────┘
                      │                       │
        ┌─────────────┴──────────┐           │
        │   Legacy Flow Path     │           │
        │ ┌───────────────────┐  │           ▼
        │ │personalityHandler │  │   ┌────────────────┐
        │ ├───────────────────┤  │   │ DDD Commands   │
        │ │conversationManager│  │   │   (Clean!)     │
        │ ├───────────────────┤  │   └────────────────┘
        │ │ referenceHandler  │  │
        │ ├───────────────────┤  │
        │ │    aiService     │  │
        │ ├───────────────────┤  │
        │ │  webhookManager  │  │
        │ └───────────────────┘  │
        └────────────────────────┘
```

## Target State: Clean Vertical Slices

```
┌─────────────────────────────────────────────────────────┐
│                   Discord Message                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               MessageRouter (50 lines)                   │
│                                                          │
│  async route(message) {                                  │
│    for (const slice of this.slices) {                  │
│      if (slice.canHandle(message)) {                   │
│        return slice.handle(message);                    │
│      }                                                  │
│    }                                                    │
│  }                                                      │
└─────┬────────┬────────┬────────┬────────┬──────────────┘
      │        │        │        │        │
      ▼        ▼        ▼        ▼        ▼
┌─────────┐┌─────────┐┌────────┐┌───────┐┌─────────┐
│Command  ││Mention  ││Active  ││Reply  ││Future   │
│Slice    ││Slice    ││Conv    ││Slice  ││Slices   │
│         ││         ││Slice   ││       ││         │
│(exists) ││(new)    ││(new)   ││(new)  ││(...)    │
└─────────┘└─────────┘└────────┘└───────┘└─────────┘
     │          │          │         │         │
     └──────────┴──────────┴─────────┴─────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │      Domain Services         │
            ├──────────────────────────────┤
            │ PersonalityService (DDD)     │
            │ ConversationService (DDD)    │
            │ AIService (cleaned up)       │
            │ WebhookService (focused)     │
            └──────────────────────────────┘
```

## Vertical Slice Example: Personality Mention

```
Current Flow (Legacy):
─────────────────────
messageHandler.checkForPersonalityMentions()
    ↓
personalityHandler.handleMention()
    ↓
conversationManager.getPersonality()
    ↓
aiService.generateResponse()
    ↓
webhookManager.sendWebhookMessage()
    ↓
[706 + 400 + 570 + 457 + 642 = 2775 lines involved!]


New Flow (DDD Slice):
────────────────────
PersonalityMentionSlice.handle()
    ↓
PersonalityRepository.findByName()  // Already exists!
    ↓
ConversationService.processMessage() // Clean domain logic
    ↓
AIService.generateResponse()         // Simplified
    ↓
WebhookService.send()               // Focused
    ↓
[~100 lines per component = ~500 lines total, clearly separated]
```

## Implementation Stages

### Stage 1: Router Foundation
```
messageHandler.js
       │
       ▼
MessageRouter ──→ legacyHandler (all messages)
```

### Stage 2: First Slice
```
messageHandler.js
       │
       ▼
MessageRouter ─┬─→ PersonalityMentionSlice (if mention detected)
               └─→ legacyHandler (everything else)
```

### Stage 3: Multiple Slices
```
messageHandler.js
       │
       ▼
MessageRouter ─┬─→ CommandSlice (if prefix)
               ├─→ PersonalityMentionSlice (if mention)
               ├─→ ActiveConversationSlice (if active)
               ├─→ ReplyContextSlice (if reply)
               └─→ legacyHandler (anything not handled)
```

### Stage 4: Legacy Removal
```
Discord
   │
   ▼
MessageRouter ─┬─→ CommandSlice
               ├─→ PersonalityMentionSlice  
               ├─→ ActiveConversationSlice
               ├─→ ReplyContextSlice
               └─→ DefaultSlice

[messageHandler.js deleted!]
```

## Feature Flag Strategy

```javascript
// Progressive rollout per slice
{
  "ddd.slice.personality-mention": {
    "default": false,
    "guilds": {
      "test-guild-id": true,    // Test in specific guild
      "prod-guild-1": true,     // Roll out gradually
      "*": false                // Default for others
    }
  }
}

// Router checks flags
if (featureFlags.isEnabled('ddd.slice.personality-mention', message.guildId)) {
  // Use new DDD slice
} else {
  // Use legacy handler
}
```

## Benefits of This Approach

1. **Incremental** - One slice at a time
2. **Testable** - Compare legacy vs DDD outputs
3. **Reversible** - Feature flags allow instant rollback
4. **Clear Progress** - Each slice = visible improvement
5. **End Goal** - Complete architectural consistency

## Key Insight

We're not refactoring the legacy code. We're building clean replacements alongside it, proving they work, then deleting the legacy code. This is safer and more satisfying than trying to refactor in place.