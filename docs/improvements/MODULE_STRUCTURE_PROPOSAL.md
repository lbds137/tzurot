# Module Structure Proposal for Tzurot

## Overview

This document proposes a comprehensive module structure to improve separation of concerns, maintainability, and scalability of the Tzurot Discord bot codebase.

## Current State Analysis

### Achievements from Recent Refactoring

We've successfully extracted multiple modules from large files:

**From webhookManager.js (2862 → 1768 lines, 38% reduction):**
- `webhookCache.js` - Webhook caching logic
- `messageDeduplication.js` - Duplicate message prevention
- `avatarManager.js` - Avatar URL management
- `messageFormatter.js` - Message formatting and splitting

**From aiService.js (1368 → 625 lines, 54% reduction):**
- `aiAuth.js` - AI authentication management
- `contentSanitizer.js` - Content sanitization
- `aiRequestManager.js` - Request deduplication and tracking
- `aiMessageFormatter.js` - Message formatting for AI API

**From personalityHandler.js (1001 → 748 lines, 25% reduction):**
- `requestTracker.js` - Active request tracking
- `personalityAuth.js` - Authentication and verification
- `threadHandler.js` - Thread-specific functionality

### Current Issues

1. **Large Files Still Exist:**
   - `webhookManager.js` (1768 lines) - Still exceeds recommended size
   - `personalityHandler.js` (748 lines) - Could be further modularized
   - `messageHandler.js` (494 lines) - Mixed responsibilities

2. **Unclear Boundaries:**
   - Some utilities have overlapping responsibilities
   - Authentication logic is spread across multiple modules
   - Message tracking exists in multiple places

3. **Testing Challenges:**
   - Large files are harder to test comprehensively
   - Complex mocking requirements due to tight coupling

## Proposed Module Structure

### Core Domain Modules

```
src/
├── core/
│   ├── personality/
│   │   ├── PersonalityManager.js      # Personality CRUD operations
│   │   ├── PersonalityRegistry.js     # In-memory personality registry
│   │   ├── PersonalityPersistence.js  # File-based persistence
│   │   └── PersonalityValidator.js    # Validation logic
│   │
│   ├── conversation/
│   │   ├── ConversationManager.js     # Conversation state management
│   │   ├── ConversationTracker.js     # Active conversation tracking
│   │   ├── MessageHistory.js          # Message history management
│   │   └── AutoResponder.js           # Auto-response logic
│   │
│   ├── authentication/
│   │   ├── AuthManager.js             # Central auth management
│   │   ├── TokenValidator.js          # Token validation
│   │   ├── AgeVerification.js         # Age verification logic
│   │   └── ProxySystemAuth.js         # PluralKit/proxy auth
│   │
│   └── ai/
│       ├── AIServiceClient.js         # AI API client
│       ├── AIRequestProcessor.js      # Request processing
│       ├── AIResponseHandler.js       # Response handling
│       └── AIErrorRecovery.js         # Error handling & retries
```

### Infrastructure Modules

```
src/
├── infrastructure/
│   ├── discord/
│   │   ├── WebhookService.js         # Webhook operations
│   │   ├── MessageService.js         # Message sending/editing
│   │   ├── ChannelService.js         # Channel operations
│   │   └── GuildService.js           # Guild operations
│   │
│   ├── storage/
│   │   ├── FileStorage.js            # File-based storage
│   │   ├── CacheManager.js           # In-memory caching
│   │   └── DataMigration.js          # Data migration utilities
│   │
│   └── monitoring/
│       ├── ErrorReporter.js          # Error reporting
│       ├── MetricsCollector.js       # Performance metrics
│       └── HealthChecker.js          # Health monitoring
```

### Application Layer

```
src/
├── application/
│   ├── commands/
│   │   ├── CommandDispatcher.js      # Command routing
│   │   ├── CommandParser.js          # Command parsing
│   │   └── handlers/                 # Individual command handlers
│   │
│   ├── handlers/
│   │   ├── MessageHandler.js         # Message event handling
│   │   ├── ReactionHandler.js        # Reaction event handling
│   │   └── InteractionHandler.js     # Interaction handling
│   │
│   └── middleware/
│       ├── AuthenticationMiddleware.js
│       ├── RateLimitMiddleware.js
│       ├── DeduplicationMiddleware.js
│       └── LoggingMiddleware.js
```

### Shared Utilities

```
src/
└── shared/
    ├── utils/
    │   ├── TextUtils.js              # Text manipulation
    │   ├── TimeUtils.js              # Time/date utilities
    │   ├── ValidationUtils.js        # Common validation
    │   └── FormatUtils.js            # Formatting helpers
    │
    ├── constants/
    │   ├── ErrorCodes.js             # Error constants
    │   ├── Markers.js                # Message markers
    │   └── Defaults.js               # Default values
    │
    └── types/
        ├── Personality.js            # Type definitions
        ├── Conversation.js           # Type definitions
        └── Message.js                # Type definitions
```

## Migration Strategy

### Phase 1: Core Domain Extraction (2-3 weeks)
1. Extract personality management into dedicated modules
2. Consolidate conversation management
3. Unify authentication logic
4. Modularize AI service interactions

### Phase 2: Infrastructure Layer (2-3 weeks)
1. Create Discord service abstractions
2. Implement storage layer
3. Set up monitoring infrastructure
4. Establish clear service boundaries

### Phase 3: Application Layer Refactoring (1-2 weeks)
1. Refactor command system
2. Simplify event handlers
3. Implement middleware pattern
4. Clean up routing logic

### Phase 4: Testing & Documentation (1 week)
1. Update all tests for new structure
2. Create integration tests
3. Update documentation
4. Create migration guide

## Benefits

1. **Improved Maintainability:**
   - Smaller, focused modules
   - Clear separation of concerns
   - Easier to understand and modify

2. **Better Testability:**
   - Isolated units for testing
   - Reduced mocking complexity
   - Higher test coverage potential

3. **Enhanced Scalability:**
   - Easy to add new features
   - Clear extension points
   - Modular architecture

4. **Reduced Coupling:**
   - Dependencies flow in one direction
   - Clear interfaces between layers
   - Easier to replace components

## Considerations

1. **Backward Compatibility:**
   - Maintain existing APIs during migration
   - Use facade pattern for gradual migration
   - Keep old modules until migration complete

2. **Performance:**
   - Monitor performance during migration
   - Optimize hot paths
   - Consider lazy loading for large modules

3. **Team Coordination:**
   - Clear communication about changes
   - Documentation of new patterns
   - Code review process for migrations

## Next Steps

1. Review and approve this proposal
2. Create detailed migration plan for Phase 1
3. Set up new directory structure
4. Begin extracting first module (PersonalityManager)
5. Establish patterns for other developers to follow

## Conclusion

This module structure proposal aims to transform Tzurot's codebase into a more maintainable, scalable, and testable architecture. By following domain-driven design principles and establishing clear boundaries between layers, we can ensure the long-term success and evolution of the project.