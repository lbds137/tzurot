# Domain-Driven Design Implementation Plan for Tzurot

## Executive Summary

This document presents a comprehensive Domain-Driven Design (DDD) approach to address the systemic architectural issues in Tzurot. Despite being only 3 weeks old, the project has accumulated significant technical debt through:

- **Band-aid fixes**: Quick patches that create more problems than they solve
- **Half-completed migrations**: Mock system at 5% completion, module refactoring stalled
- **Cascading dependencies**: Simple changes touching 50+ files
- **God objects**: Personality system as a central dependency
- **Mixed responsibilities**: Utils folder with 28 files doing unrelated things

## The Systemic Problem

### Technical Debt Accumulation Pattern

```
Week 1: MVP Rush → Monolithic files (2000+ lines)
Week 2: Quick Fixes → Facade patterns, backwards compatibility layers
Week 3: Partial Refactors → Incomplete migrations, inconsistent patterns
Result: 3 weeks = 3 years of technical debt
```

### Evidence of Systemic Issues

1. **Mock Migration**: Started, 5% complete, 125/133 tests still using legacy patterns
2. **Module Refactoring**: Extracted some utilities, but core issues remain
3. **Async Cascade**: One method change required updating 52 files
4. **Production Regressions**: Multiple issues from incomplete testing
5. **Directory Structure**: Mix of old patterns, new patterns, and half-migrated code

## Domain-Driven Design Solution

### Core Domains Identified

Based on analysis, Tzurot has four core domains:

1. **Personality Domain**: Managing AI personalities
2. **Conversation Domain**: Handling user interactions
3. **Authentication Domain**: User and personality access control
4. **AI Integration Domain**: External AI service interaction

### Proposed Bounded Contexts

```
┌─────────────────────────────────────────────────────────────┐
│                     Personality Context                      │
├─────────────────────────────────────────────────────────────┤
│ Aggregates:                                                 │
│ - Personality (root)                                        │
│   - DisplayInfo (value object)                             │
│   - Configuration (value object)                           │
│   - ErrorMessages (value object)                           │
│                                                             │
│ Domain Services:                                            │
│ - PersonalityRepository                                     │
│ - PersonalityFactory                                        │
│                                                             │
│ Domain Events:                                              │
│ - PersonalityCreated                                        │
│ - PersonalityUpdated                                        │
│ - PersonalityDeleted                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Conversation Context                      │
├─────────────────────────────────────────────────────────────┤
│ Aggregates:                                                 │
│ - Conversation (root)                                       │
│   - Message (entity)                                        │
│   - Participant (value object)                             │
│                                                             │
│ Domain Services:                                            │
│ - ConversationRepository                                    │
│ - MessageFormatter                                          │
│ - ConversationRouter                                        │
│                                                             │
│ Domain Events:                                              │
│ - ConversationStarted                                       │
│ - MessageReceived                                           │
│ - ResponseGenerated                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Authentication Context                     │
├─────────────────────────────────────────────────────────────┤
│ Aggregates:                                                 │
│ - UserAuth (root)                                          │
│   - Token (value object)                                   │
│   - Permissions (value object)                             │
│                                                             │
│ Domain Services:                                            │
│ - AuthenticationService                                     │
│ - TokenValidator                                            │
│ - PermissionChecker                                         │
│                                                             │
│ Domain Events:                                              │
│ - UserAuthenticated                                         │
│ - TokenExpired                                              │
│ - PermissionGranted                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    AI Integration Context                    │
├─────────────────────────────────────────────────────────────┤
│ Aggregates:                                                 │
│ - AIRequest (root)                                         │
│   - RequestContent (value object)                          │
│   - ResponseContent (value object)                         │
│                                                             │
│ Domain Services:                                            │
│ - AIClient                                                  │
│ - RequestBuilder                                            │
│ - ResponseParser                                            │
│                                                             │
│ Anti-Corruption Layer:                                      │
│ - APIAdapter (shields domain from external API changes)    │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Strategy: No More Half-Measures

#### Phase 0: Stop the Bleeding (1 week)
**Goal**: Prevent further degradation while planning

1. **Feature Freeze**: No new features until architecture stabilized
2. **Document All WIP**: List all incomplete migrations/refactors
3. **Critical Bug Fixes Only**: With full regression testing
4. **Establish Metrics**: 
   - File size violations
   - Circular dependencies
   - Test coverage gaps
   - Mock pattern violations

#### Phase 1: Create Clean Core (2 weeks)
**Goal**: Build new domain modules WITHOUT touching existing code

```
src/
├── domain/              # NEW - Pure domain logic
│   ├── personality/
│   │   ├── Personality.js
│   │   ├── PersonalityRepository.js
│   │   └── PersonalityEvents.js
│   ├── conversation/
│   │   ├── Conversation.js
│   │   ├── ConversationRepository.js
│   │   └── ConversationEvents.js
│   ├── authentication/
│   │   ├── UserAuth.js
│   │   ├── AuthRepository.js
│   │   └── AuthEvents.js
│   └── shared/
│       ├── DomainEvent.js
│       └── ValueObject.js
```

**Key Rules**:
- NO dependencies on existing code
- 100% test coverage from start
- Pure domain logic only
- Event-driven communication

#### Phase 2: Build Adapters (2 weeks)
**Goal**: Connect new domain to existing infrastructure

```
src/
├── adapters/            # NEW - Bridge old to new
│   ├── discord/
│   │   ├── DiscordMessageAdapter.js
│   │   └── DiscordWebhookAdapter.js
│   ├── persistence/
│   │   ├── FilePersonalityRepository.js
│   │   └── MemoryConversationRepository.js
│   └── ai/
│       ├── AnthropicAdapter.js
│       └── ResponseAdapter.js
```

#### Phase 3: Gradual Migration (4 weeks)
**Goal**: Move functionality to new architecture systematically

**Week 1**: Personality System
- Route all personality operations through new domain
- Keep old system as read-only backup
- Monitor for regressions

**Week 2**: Conversation System
- Migrate conversation tracking
- Update message handlers
- Maintain parallel systems

**Week 3**: Authentication
- Centralize all auth through new domain
- Remove scattered auth checks
- Unified permission system

**Week 4**: AI Integration
- Single point of AI interaction
- Remove duplicate error handling
- Consistent response formatting

#### Phase 4: Cleanup (2 weeks)
**Goal**: Remove all old code

1. **Delete Legacy Systems**: Once new system proven
2. **Remove Facades**: No more backwards compatibility
3. **Consolidate Tests**: Single consistent pattern
4. **Update Documentation**: Reflect new architecture

### Success Metrics

1. **Immediate** (Phase 0-1):
   - No files > 500 lines
   - No circular dependencies in new code
   - 100% test coverage for domain layer

2. **Short-term** (Phase 2-3):
   - 50% reduction in files touched per change
   - 90% reduction in cascading async changes
   - Zero production regressions during migration

3. **Long-term** (Phase 4+):
   - Average PR touches < 5 files
   - New features implementable in single bounded context
   - Test suite runs in < 30 seconds

### Avoiding Previous Pitfalls

1. **No Partial Migrations**
   - Complete each phase before moving on
   - Delete old code immediately after migration
   - No "we'll clean it up later"

2. **No Backwards Compatibility**
   - Break things intentionally
   - Fix all consumers immediately
   - Rip off the band-aid

3. **No Compromise on Quality**
   - 100% test coverage for new code
   - Code review every PR
   - Reject shortcuts

4. **Clear Ownership**
   - Each bounded context has an owner
   - Owner responsible for migration completion
   - Weekly progress reviews

### Technical Implementation Details

#### Event Bus Architecture
```javascript
// Domain events flow between contexts
class DomainEventBus {
  async publish(event) {
    // Route to interested contexts
  }
  
  subscribe(eventType, handler) {
    // Register handlers
  }
}

// Example usage
personalityContext.on('PersonalityCreated', async (event) => {
  await conversationContext.handleNewPersonality(event);
});
```

#### Repository Pattern
```javascript
// Clean separation of persistence
class PersonalityRepository {
  async findByName(name) {
    // Returns domain object, not raw data
  }
  
  async save(personality) {
    // Handles persistence, emits events
  }
}
```

#### Anti-Corruption Layer
```javascript
// Shields domain from external changes
class AnthropicAPIAdapter {
  async sendRequest(domainRequest) {
    // Convert domain object to API format
    const apiRequest = this.transformRequest(domainRequest);
    const apiResponse = await this.client.send(apiRequest);
    // Convert API response to domain object
    return this.transformResponse(apiResponse);
  }
}
```

## Conclusion

The current architecture is unsustainable. Every "quick fix" makes the next change harder. This DDD approach provides a clear path to a maintainable system, but it requires discipline:

1. **Complete commitment**: No half-measures, no shortcuts
2. **Systematic execution**: Follow the phases in order
3. **Quality over speed**: Better to do it right than do it twice
4. **Learn from mistakes**: The mock migration failure shows what happens with partial efforts

The alternative is continuing to accumulate debt until the system becomes unmaintainable. At the current rate, the project will be effectively frozen within another 3 weeks.

This plan requires approximately 11 weeks of focused effort, but it will result in a system that can evolve for years rather than weeks.