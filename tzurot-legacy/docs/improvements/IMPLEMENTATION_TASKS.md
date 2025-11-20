# Implementation Tasks for Vertical Slice Migration

## Immediate Next Steps for Claude Code

### Task 1: Create Message Router Infrastructure

**Files to create:**
- `src/core/routing/MessageRouter.js`
- `src/core/routing/MessageRouter.test.js`

**Files to modify:**
- `src/handlers/messageHandler.js` - Add delegation to router

**Implementation notes:**
```javascript
// In messageHandler.js handleMessage function, near the top:
const router = getMessageRouter();
if (router.isEnabled()) {
  return router.route(message, client, authManager);
}
// ... existing legacy code continues
```

**Feature flags to add:**
```javascript
// In src/application/services/FeatureFlags.js
'ddd.routing.enabled': false,
'ddd.slice.personality-mention': false,
'ddd.slice.active-conversation': false,
'ddd.slice.reply-context': false,
```

### Task 2: First Vertical Slice - Personality Mention

**Files to create:**
- `src/application/slices/PersonalityMentionSlice.js`
- `src/application/slices/PersonalityMentionSlice.test.js`
- `src/domain/conversation/MessageContext.js`

**Logic to extract from:**
- `src/handlers/messageHandler.js` - `checkForPersonalityMentions()`
- `src/handlers/personalityHandler.js` - mention handling logic

**Key implementation points:**
1. Reuse existing `PersonalityRepository` from DDD
2. Create clean mention detection without regex soup
3. Use event bus to emit `PersonalityMentioned` event
4. Route through simplified AI service interface

### Task 3: Create Simplified Webhook Service

**Files to create:**
- `src/domain/infrastructure/WebhookService.js`
- `src/domain/infrastructure/WebhookService.test.js`

**Extract from:**
- `src/webhookManager.js` - Just the sending logic
- `src/utils/webhookCache.js` - Reuse as-is

**Interface:**
```javascript
class WebhookService {
  async send({ channel, message, personality }) {
    // Simple, focused implementation
  }
}
```

### Task 4: Integration Testing Infrastructure

**Files to create:**
- `tests/integration/vertical-slices/PersonalityMentionSlice.test.js`
- `tests/integration/vertical-slices/SliceTestHelper.js`

**Test approach:**
1. Send same message through legacy and DDD paths
2. Compare the webhook payloads
3. Ensure identical user experience

## Code Review Checklist

For each slice implementation:

- [ ] Slice handler implements `canHandle()` and `handle()` methods
- [ ] No direct imports from legacy code (only interfaces)
- [ ] Uses existing domain models where available
- [ ] Emits appropriate domain events
- [ ] Has comprehensive unit tests
- [ ] Has integration test comparing with legacy
- [ ] Feature flag added and defaults to false
- [ ] No modifications to legacy code (only router integration)

## Gotchas to Watch For

1. **Personality Resolution**
   - Legacy uses complex alias resolution
   - Make sure DDD path handles all cases
   - Test with aliases, not just full names

2. **Message Deduplication**
   - Legacy has multiple dedup mechanisms
   - Ensure DDD path doesn't double-respond
   - May need to share dedup state initially

3. **Error Messages**
   - Legacy has user-specific error messages
   - Ensure feature parity in responses
   - Test error cases thoroughly

4. **Webhook Caching**
   - Reuse existing webhook cache
   - Don't recreate caching logic
   - Test with channel/thread variations

## Progress Tracking

Create a simple progress tracker in the PR description:

```markdown
## Vertical Slice Migration Progress

- [x] Message Router infrastructure
- [ ] Personality Mention slice
  - [x] Implementation
  - [x] Unit tests  
  - [ ] Integration tests
  - [ ] Feature flag testing
  - [ ] Production rollout
- [ ] Active Conversation slice
- [ ] Reply Context slice
- [ ] Command integration
- [ ] Legacy cleanup

Current state: Testing personality mentions in dev
```

## Questions to Resolve

1. **Correlation IDs** - Add now or later?
2. **Metrics/Logging** - What level of instrumentation?
3. **Migration order** - Confirm personality mentions first?
4. **Testing strategy** - A/B test in production?

## Start Here

1. Create feature branch: `feature/vertical-slice-migration`
2. Implement Message Router (Task 1)
3. Verify all tests pass with router disabled
4. Implement first slice (Task 2)
5. Test extensively
6. Submit PR for review

Remember: The goal is architectural consistency, not perfection. Each slice should be clean and follow DDD patterns, but doesn't need to be over-engineered.