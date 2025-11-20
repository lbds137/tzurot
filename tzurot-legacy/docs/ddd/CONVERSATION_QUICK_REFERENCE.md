# Conversation Domain - Quick Reference

## TL;DR: Why It's Not Ready

The DDD Conversation domain looks complete but is missing 60% of required functionality:

### ❌ Critical Missing Features
1. **Message Tracking** - Can't map Discord message IDs to personalities (breaks replies)
2. **Auto-Response Users** - Can't track who has auto-response enabled globally
3. **Channel Activation** - Can't track which personality is active per channel
4. **Multi-Personality** - Can't handle multiple personalities in same channel
5. **Application Service** - No orchestration layer exists

### 📁 What Exists
```
src/domain/conversation/
├── Conversation.js          ✅ Complete aggregate
├── Message.js              ✅ Complete value object
├── ConversationSettings.js ✅ Complete value object
├── ConversationId.js       ✅ Complete (but flawed design)
├── ConversationEvents.js   ✅ All events defined
└── ConversationRepository.js ✅ Interface defined

src/adapters/persistence/
└── FileConversationRepository.js ✅ Basic implementation (missing features)
```

### 🔧 What Needs Building
```
src/domain/conversation/
├── MessageTracker.js       ❌ Needs creation
├── ChannelActivation.js    ❌ Needs creation
└── UserPreferences.js      ❌ Needs creation

src/application/services/
└── ConversationApplicationService.js ❌ Needs creation

src/adapters/persistence/
├── FileMessageMappingRepository.js    ❌ Needs creation
├── FileChannelActivationRepository.js ❌ Needs creation
└── FileUserPreferencesRepository.js   ❌ Needs creation
```

## Legacy vs DDD Feature Comparison

| Feature | Legacy | DDD | Gap |
|---------|--------|-----|-----|
| Track conversations | ✅ `recordConversation()` | ✅ `Conversation.start()` | Different API |
| Message mapping | ✅ Maps message IDs | ❌ No mapping | **CRITICAL** |
| Auto-response users | ✅ Global tracking | ❌ Only per-conversation | **CRITICAL** |
| Channel activation | ✅ Full system | ❌ Not implemented | **CRITICAL** |
| Multiple personalities | ✅ Supported | ⚠️ Partial | Needs work |
| Clear conversation | ✅ By personality | ❌ Would clear all | Breaking change |
| Get personality from message | ✅ For replies | ❌ Not possible | **CRITICAL** |

## Quick Code Comparison

### Legacy Message Tracking
```javascript
// Legacy - Maps message IDs to personalities
conversationManager.recordConversation(
  userId, 
  channelId, 
  ['msgId1', 'msgId2'],  // Discord message IDs
  'Claude'               // Personality name
);

// Later: Find who sent a message
const personality = conversationManager.getPersonalityFromMessage('msgId1');
// Returns: 'Claude'
```

### DDD Has No Equivalent!
```javascript
// DDD - No message ID tracking
const conversation = Conversation.start(
  conversationId,  // Composite ID, no message mapping
  message,         // Message object, ID not tracked
  personalityId
);

// Later: Find who sent a message
// ❌ NOT POSSIBLE - No way to query by message ID
```

## Effort to Complete

| Component | Effort | Priority | Why |
|-----------|--------|----------|-----|
| Message Tracking | 1 week | CRITICAL | Breaks reply detection |
| Auto-Response | 3 days | HIGH | Autorespond command fails |
| Channel Activation | 1 week | HIGH | Activate command fails |
| Application Service | 1 week | CRITICAL | No orchestration |
| Testing & Migration | 1 week | CRITICAL | Must maintain compatibility |
| **TOTAL** | **4 weeks** | - | - |

## Key Blockers

### 1. Architectural Mismatch
- Legacy tracks by `userId-channelId-personality`
- DDD tracks by `userId-channelId` only
- Requires redesign of ConversationId

### 2. Missing Infrastructure
- No Bootstrap integration
- No Application Service
- No migration path

### 3. Data Model Issues
- Legacy has 4 data structures (conversations, messages, channels, users)
- DDD has 1 (conversations only)
- Need 3 new aggregates minimum

## When to Resume This Work

Resume Conversation domain migration when:
1. ✅ AI Service migration is complete
2. ✅ You have 4 weeks to dedicate
3. ✅ You're ready to build missing aggregates
4. ✅ You can run shadow mode for safety

## Quick Start When Resuming

1. **Read these docs**:
   - `CONVERSATION_DOMAIN_DETAILED_ANALYSIS.md` - Full implementation guide
   - `CONVERSATION_DOMAIN_GAP_ANALYSIS.md` - Missing features
   - This quick reference

2. **Start with Message Tracking**:
   - Most critical missing feature
   - Blocks reply functionality
   - Clear implementation path

3. **Use Shadow Mode**:
   - Run both systems in parallel
   - Write to both, read from legacy
   - Validate outputs match

## Bottom Line

**Don't migrate Conversation domain yet.** It needs ~4 weeks of work to match legacy functionality. The domain models are nice but it's missing critical infrastructure for:
- Message reply detection
- Command functionality (activate, autorespond)
- Multi-personality support

Focus on AI Service migration first - it's much more straightforward.