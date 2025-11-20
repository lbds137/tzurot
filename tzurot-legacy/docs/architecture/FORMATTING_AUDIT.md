# Message Formatting Dependency Audit

## Executive Summary
Based on code analysis, message formatting is scattered across 5 key utility files with complex interdependencies. The main formatting flow touches 3 webhook handlers and involves multiple transformation stages.

## Key Formatting Utilities

### 1. `contextMetadataFormatter.js`
**Purpose**: Adds Discord context metadata to messages
**Used by**:
- `aiMessageFormatter.js` (3 call sites)
**Function**: `formatContextMetadata(message)` 
**Output**: `"[Discord: ServerName > #channel | 2024-07-10T15:30:45Z]"`

### 2. `aiMessageFormatter.js` 
**Purpose**: Formats messages for AI API requests
**Used by**:
- `aiService.js` (imports `formatApiMessages`)
**Key Functions**:
- `formatApiMessages()` - Main export, builds message array for API
- Handles text, images, audio, references
- Adds context metadata when enabled
- Complex PluralKit formatting logic

### 3. `messageSplitting.js`
**Purpose**: Handles Discord's 2000 character limit
**Used by**:
- `webhookManager.js`
- `dmHandler.js`
- `threadHandler.js`
**Key Functions**:
- `prepareAndSplitMessage()` - Main entry point
- `splitMessage()` - Core splitting logic
- Handles model indicators, code blocks, paragraphs

### 4. `messageFormatter.js`
**Purpose**: Various message formatting utilities
**Used by**:
- `webhookManager.js`
**Note**: Need to investigate specific functions

### 5. `aliasResolver.js` (indirect formatting)
**Purpose**: Resolves personality mentions
**Used by**:
- `messageHandler.js` (for mention detection)
- `aiMessageFormatter.js`

## Message Flow Analysis

### Primary Flow (Channel Message with Personality)
```
1. bot.js → messageHandler.js
2. messageHandler.checkForPersonalityMentions()
   - Uses regex with configurable max word count
   - Strips mentions from content
3. personalityHandler.js → aiService.js
4. aiService.formatApiMessages() [via aiMessageFormatter.js]
   - Adds context metadata
   - Formats for AI API
5. AI Response → webhookManager.js
6. webhookManager.prepareAndSplitMessage() [via messageSplitting.js]
   - Adds model indicators
   - Splits into chunks
7. Webhook sends formatted chunks
```

### DM Flow
```
1. bot.js → messageHandler.js → dmHandler.js
2. dmHandler.js → aiService.js (same formatting)
3. Response → dmHandler.prepareAndSplitMessage()
```

### Thread Flow
```
1. Thread message → threadHandler.js
2. threadHandler.prepareAndSplitMessage()
```

## Formatting Operations (In Order)

### Input Processing (messageHandler.js)
1. **Mention Detection** - Regex pattern with multi-word support
2. **Mention Stripping** - Removes @personality from content
3. **PluralKit Detection** - Identifies proxy messages

### AI Request Formatting (aiMessageFormatter.js)
1. **Context Metadata Addition** - Server/channel/timestamp
2. **Reference Fetching** - Gets referenced message content
3. **Media Processing** - Handles images/audio
4. **PluralKit Formatting** - Special proxy format

### Output Processing (messageSplitting.js)
1. **Model Indicator Addition** - "(Fallback Model Used)" etc
2. **Message Splitting** - Respects 2000 char limit
3. **Code Block Preservation** - Maintains formatting
4. **Chunk Delay** - Prevents rate limiting

## Hidden Dependencies Found

### Configuration Dependencies
- `messageHandlerConfig.getMaxAliasWordCount()` - Dynamic regex generation
- `botConfig.mentionChar` - @ vs & for mentions
- Context metadata can be disabled per personality

### State Dependencies
- PluralKit message store for proxy detection
- Webhook user tracker for identifying webhooks
- Message tracker for deduplication
- Conversation manager for active personalities

### Timing Dependencies
- All handlers use injectable delay functions
- Chunk sending has configurable delays
- No direct setTimeout calls found ✅

## Risk Assessment

### High Risk Areas
1. **Mention Stripping** - Complex regex with dynamic word count
2. **Message Splitting** - Must preserve markdown/code blocks
3. **Context Metadata** - Multiple injection points

### Medium Risk Areas
1. **Model Indicators** - Added at different stages
2. **PluralKit Formatting** - Special cases throughout

### Low Risk Areas
1. **Timestamp Formatting** - Simple ISO conversion
2. **Channel Path Building** - Straightforward logic

## Migration Challenges

### Challenge 1: Multiple Entry Points
- Channel messages, DMs, and threads all format differently
- Each has its own handler with slightly different logic

### Challenge 2: Context Requirements
- Many formatting steps need Discord message object
- Some need guild, channel, user objects
- Configuration settings scattered

### Challenge 3: Order Matters
- Model indicator must be added BEFORE splitting
- Context metadata added at different points
- Mention stripping must happen early

## Recommendations

### Phase 0: Pre-Migration Setup (NEW - Do This First!)
1. **Create comprehensive test suite**
   - Capture current outputs for all message types
   - Golden master tests as Gemini suggested
   - Edge cases: long messages, code blocks, mentions

2. **Document current behavior precisely**
   - What order do transformations happen?
   - What are all the edge cases?
   - What configuration affects formatting?

### Phase 1: Create Clean Interfaces
1. Define `MessageContext` object with ALL needed data
2. Create `FormattingStep` base class
3. Build pipeline infrastructure

### Phase 2: Migrate Safest Operations First
1. Start with timestamp formatting (simplest)
2. Then context metadata (well-contained)
3. Leave mention stripping for later (complex)

### Phase 3: Parallel Run
1. Keep old system intact
2. Run new pipeline in parallel
3. Compare outputs
4. Use feature flag to switch

### Phase 4: Complex Operations
1. Migrate mention detection/stripping
2. Migrate message splitting
3. Migrate PluralKit handling

## Files to Examine in Detail

Priority 1 (Core Flow):
- `/src/handlers/messageHandler.js` - Lines 37-107 (mention detection)
- `/src/utils/aiMessageFormatter.js` - Main formatting logic
- `/src/utils/messageSplitting.js` - Splitting algorithm

Priority 2 (Output):
- `/src/webhookManager.js` - Lines around 306-310
- `/src/webhook/dmHandler.js` - Lines around 151-155
- `/src/webhook/threadHandler.js` - Lines around 109-113

Priority 3 (Configuration):
- `/src/config/MessageHandlerConfig.js` - Dynamic configuration
- `/src/utils/contextMetadataFormatter.js` - Context building

## Next Steps

1. ✅ **Run Golden Master Test Creation** (30 mins)
   - Capture 20-30 different message scenarios
   - Save current outputs

2. **Build Context Object Structure** (30 mins)
   - Define all data needed by formatting steps
   - Create builder/factory

3. **Create Pipeline Infrastructure** (1 hour)
   - Base classes
   - Pipeline runner
   - Error handling

4. **Migrate First Step** (30 mins)
   - Start with contextMetadataFormatter
   - Easiest to test in isolation

## Complexity Score: 7/10

The formatting system is more complex than initially thought due to:
- Multiple entry points with different flows
- Deep Discord API integration requirements
- Order-dependent operations
- Configuration scattered across multiple systems

However, the migration is still feasible with careful planning and the incremental approach outlined above.