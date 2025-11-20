# Message Formatting Domain - Migration Plan

## Problem Statement

Message content formatting is scattered across multiple utils files, making it impossible to track where content gets modified. This makes adding features like voice toggle extremely difficult.

## Current Pain Points

- Content modified in: aiMessageFormatter, messageFormatter, contextMetadataFormatter, messageSplitting, etc.
- No clear order of operations
- Can't add voice prefix without archaeology through multiple files
- Don't know where to add new formatting steps

## Proposed Domain Structure

```
src/domain/formatting/
  MessageContent.js          <- Value object wrapping message content
  FormattingPipeline.js      <- Core service that runs steps in order
  FormattingStep.js          <- Interface all steps must implement

  steps/                     <- All formatting operations in one place
    StripMentionsStep.js    <- Remove @personality mentions
    AddVoicePrefixStep.js    <- Add !voice if user preference enabled
    AddContextMetadataStep.js <- Add [Discord: server > #channel | timestamp]
    TrimWhitespaceStep.js    <- Clean up extra spaces
    SplitLongMessageStep.js  <- Handle 2000 char limit

src/infrastructure/formatting/
  FilePreferenceProvider.js  <- Gets user prefs for voice toggle etc

src/application/formatting/
  MessageFormattingService.js <- Simple API for legacy code to use
```

## Implementation Steps

### Phase 1: Create Domain Structure (30 mins)

```bash
git checkout -b feat/formatting-domain
```

1. Create directory structure
2. Create FormattingStep interface
3. Create MessageContent value object
4. Create basic FormattingPipeline that accepts steps

### Phase 2: Migrate First Step (30 mins)

1. Find mention stripping logic (probably in messageHandler.js)
2. Create StripMentionsStep.js
3. Test it works in isolation
4. Wire into pipeline

### Phase 3: Add Integration Point (30 mins)

1. Create MessageFormattingService.js
2. Add single method: `formatMessage(content, context)`
3. Update ONE place in messageHandler.js to use it
4. Verify bot still works

### Phase 4: Migrate Remaining Steps (1-2 hours)

1. Move context metadata formatting
2. Move whitespace trimming
3. Move message splitting
4. Move any other formatting logic found

### Phase 5: Add Voice Feature (30 mins)

1. Create AddVoicePrefixStep.js
2. Add to pipeline
3. Connect to user preferences
4. Test voice toggle works!

### Phase 6: Cleanup (30 mins)

1. Remove old formatting utils (after confirming everything works)
2. Update tests
3. Document the pipeline

## Success Criteria

- [ ] All formatting happens through the pipeline
- [ ] Can see exact order of operations
- [ ] Voice toggle works with single step addition
- [ ] Legacy code uses new domain through simple API
- [ ] Tests pass
- [ ] No more hunting for where content gets modified

## Key Files to Examine First

- src/handlers/messageHandler.js (lines ~37-107 for mention stripping)
- src/utils/aiMessageFormatter.js (for how AI messages are formatted)
- src/utils/contextMetadataFormatter.js (for context addition)
- src/utils/messageSplitting.js (for 2000 char handling)

## Testing Strategy

1. Unit test each step in isolation
2. Integration test the full pipeline
3. Manual test with bot:
   - Regular mention
   - Multi-word mention (bug we just fixed)
   - Long message splitting
   - Voice prefix with user pref

## Risk Mitigation

- Keep old formatting code until new domain is proven
- Start with ONE integration point
- Can rollback by switching back to old formatters
- Each step is independent - if one breaks, others still work

## Next Session Starting Point

1. Open this file
2. Create branch: `git checkout -b feat/formatting-domain`
3. Start with Phase 1: Create directory structure
4. Follow the plan step by step

## Command Reference

```bash
# Create structure
mkdir -p src/domain/formatting/steps
mkdir -p src/infrastructure/formatting
mkdir -p src/application/formatting

# Find existing formatting code
grep -r "content.*replace\|message.*trim\|formatContextMetadata" src/

# Test the bot
npm run dev

# Run tests
npm test tests/unit/handlers/messageHandler.test.js
```

Remember: This is a SMALL domain that solves a REAL problem. If it works, we know the pattern for migrating other pieces. If it doesn't, we only wasted a few hours, not months.
