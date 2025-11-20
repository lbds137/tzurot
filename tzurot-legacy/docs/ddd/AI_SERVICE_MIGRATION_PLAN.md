# AI Service Migration Plan

## Overview

This document outlines the complete migration plan for moving AI service functionality from the legacy `aiService.js` to the DDD architecture. This migration represents moving ~15% of the core bot functionality.

## Current State

### Legacy Components

- **`src/aiService.js`** - Monolithic service handling all AI interactions
  - Request generation and formatting
  - API calls via node-fetch
  - Error handling and retries
  - Response processing
  - Request deduplication
  - Creates AI client using legacy auth methods

### Existing DDD Components (Unused)

- **`src/domain/ai/`** - Domain models ready but not integrated
  - AIRequest value object
  - AIResponse value object
  - ContentModerator domain service
- **`src/adapters/ai/`** - Adapter ready but not used
  - HttpAIServiceAdapter
  - AIServiceAdapterFactory

### Already Integrated DDD Components

- **Authentication** - Already being used in message flow!
  - `personalityHandler.js` uses `authService.checkPersonalityAccess()`
  - `dmHandler.js` uses `authService.getAuthenticationStatus()`
  - This proves DDD services can integrate with legacy flow

### Integration Points

The AI service is called from:

1. **`personalityHandler.js`** - Main integration point
2. **`referenceHandler.js`** - For building reference context
3. **`dmHandler.js`** - Direct message handling

## Migration Strategy

### Phase 1: Create Application Service (Week 1)

**Goal**: Create AIApplicationService that wraps existing functionality

1. **Create `src/application/services/AIApplicationService.js`**
   - Constructor takes: aiAdapter, authService, personalityService, eventBus
   - Main method: `generateResponse({ userId, personalityName, messages, context })`
   - Port logic from `aiService.js` methods

2. **Key Methods to Port**:

   ```javascript
   // From aiService.js
   generateAIRequest() → buildRequest()
   callAIService() → sendRequest()
   handleAPIError() → handleError()
   createAIClient() → (use authService)
   ```

3. **Wire in ApplicationBootstrap**:
   - Add AIApplicationService to service initialization
   - Inject HttpAIServiceAdapter and dependencies

### Phase 2: Port Core Logic (Week 1-2)

**Goal**: Move business logic while maintaining exact behavior

1. **Request Building**:
   - Port `generateAIRequest` logic to application service
   - Keep exact same request format
   - Maintain all edge cases (media, references, etc.)

2. **Error Handling**:
   - Port error classification logic
   - Maintain personality-specific error messages
   - Keep retry logic identical

3. **Response Processing**:
   - Port response validation
   - Maintain model indicator logic
   - Keep all response formatting

### Phase 3: Update Integration Points (Week 2)

**Goal**: Switch personalityHandler to use DDD service

1. **Modify `personalityHandler.js`**:

   ```javascript
   // Before
   const response = await aiService.generateAIRequest(messages, personalityData, ...)

   // After
   const aiAppService = applicationBootstrap.getServices().aiApplicationService;
   const response = await aiAppService.generateResponse({
     userId: message.author.id,
     personalityName: personality.name,
     messages,
     context
   });
   ```

2. **Update Error Handling**:
   - Ensure webhook error messages still work
   - Maintain all error ID generation
   - Keep error logging patterns

3. **Maintain Backward Compatibility**:
   - Keep aiService.js exports for other callers
   - Delegate to AIApplicationService internally

### Phase 4: Complete Migration (Week 3)

**Goal**: Update remaining callers and deprecate legacy

1. **Update Secondary Callers**:
   - `referenceHandler.js` - Update to use new service
   - `dmHandler.js` - Migrate DM handling

2. **Add Domain Events**:
   - AIRequestInitiated
   - AIResponseGenerated
   - AIRequestFailed

3. **Deprecate Legacy**:
   - Mark aiService.js methods as deprecated
   - Add migration notes to each method
   - Plan removal in future version

## Testing Strategy

### Unit Tests

1. **Port existing aiService tests** to AIApplicationService
2. **Maintain 100% behavior compatibility** - same inputs → same outputs
3. **Add integration tests** between application service and adapter

### Integration Tests

1. **Side-by-side testing** - Run both services, compare outputs
2. **Discord integration tests** - Ensure messages still flow correctly
3. **Error scenario testing** - Verify all error paths work

### Rollback Plan

Since we're not using feature flags:

1. Keep aiService.js fully functional
2. Single switch point in personalityHandler.js
3. Can revert with one-line change

## Success Criteria

### Functional Requirements

- [ ] All AI requests work identically to before
- [ ] Error messages display correctly via webhooks
- [ ] Model indicators appear in messages
- [ ] Request deduplication still works
- [ ] Media handling unchanged

### Technical Requirements

- [ ] No performance degradation
- [ ] Clean separation of concerns
- [ ] All tests passing
- [ ] No circular dependencies
- [ ] Event bus integration working

### Migration Checkpoints

- [ ] Week 1: Application service created and tested
- [ ] Week 2: Core logic ported, personalityHandler updated
- [ ] Week 3: All callers migrated, legacy deprecated

## Risks and Mitigations

### Risk 1: Breaking Message Flow

**Mitigation**: Extensive integration testing, gradual rollout

### Risk 2: Losing Error Context

**Mitigation**: Port all error handling logic exactly, test error scenarios

### Risk 3: Performance Issues

**Mitigation**: Benchmark before/after, profile if needed

### Risk 4: Circular Dependencies

**Mitigation**: Use dependency injection, no bootstrap imports

## Future Enhancements (Post-Migration)

Once migration is stable:

1. **Improve request building** - Use domain models fully
2. **Add caching layer** - Reduce API calls
3. **Enhance error handling** - Better retry strategies
4. **Add metrics** - Track success rates, latency
5. **Support multiple AI providers** - Not just OpenAI

## Decision Log

### Why No Feature Flags?

- User experience: Flags created more problems than they solved
- Simpler migration: One switch point in personalityHandler
- Easier testing: No combinatorial explosion
- Clean cutover: Either legacy or DDD, not both

### Why AI Service First?

- Clear boundaries: Well-defined inputs/outputs
- High impact: Core to every interaction
- Existing scaffolding: Domain models ready
- Independent: Few dependencies on other domains
