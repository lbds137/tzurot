# Architecture Overview - Tzurot Discord Bot

*Last Updated: June 18, 2025*

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Current State: Dual Architecture](#current-state-dual-architecture)
4. [Legacy Architecture (Active)](#legacy-architecture-active)
5. [DDD Architecture (Built, Inactive)](#ddd-architecture-built-inactive)
6. [Integration Layer](#integration-layer)
7. [Data Flow Comparison](#data-flow-comparison)
8. [Deployment Architecture](#deployment-architecture)
9. [Migration Strategy](#migration-strategy)

## Executive Summary

Tzurot is a Discord bot that enables AI personalities to interact through webhooks. The system currently operates with a **dual architecture**:

1. **Legacy System** (100% active) - The original monolithic architecture handling all production traffic
2. **DDD System** (0% active) - A fully-built Domain-Driven Design architecture ready for activation via feature flags

This document describes both architectures and their integration strategy.

## System Overview

### Core Functionality
- Multiple AI personalities with distinct behaviors
- Webhook-based message delivery for authentic Discord presence
- Conversation tracking and context management
- User authentication and permissions
- Media handling (images, audio)
- Channel activation and auto-response features

### Technology Stack
- **Runtime**: Node.js 22.x
- **Framework**: Discord.js v14
- **Storage**: JSON file-based (migration to PostgreSQL planned)
- **AI Integration**: External AI API service
- **Deployment**: Railway (single instance)

## Current State: Dual Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Discord Bot System                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐        ┌──────────────────┐          │
│  │  Discord.js     │        │ Feature Flags    │          │
│  │  Message Event  │───────▶│ (All FALSE)      │          │
│  └─────────────────┘        └────────┬─────────┘          │
│                                      │                      │
│                                      ▼                      │
│  ┌─────────────────────────────────────────────────────┐  │
│  │          CommandIntegrationAdapter                   │  │
│  │  if (featureFlag) { ──────────────────────┐         │  │
│  │      // Use DDD System                    │         │  │
│  │  } else {                                 │         │  │
│  │      // Use Legacy System ✓               │         │  │
│  │  }                                        │         │  │
│  └───────────────┬───────────────────────────┴─────────┘  │
│                  │                           │              │
│                  ▼                           ▼              │
│  ┌───────────────────────────┐  ┌────────────────────┐    │
│  │    Legacy System          │  │    DDD System      │    │
│  │    (100% Active)          │  │    (0% Active)     │    │
│  │                           │  │                    │    │
│  │  • Monolithic handlers    │  │  • Bounded contexts│    │
│  │  • Direct file I/O        │  │  • Domain models   │    │
│  │  • Procedural style       │  │  • Event-driven    │    │
│  │  • Working perfectly      │  │  • Ready to go     │    │
│  └───────────────────────────┘  └────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Legacy Architecture (Active)

### Component Structure

```
src/
├── bot.js                    # Main Discord client and message routing
├── commands/
│   ├── commandProcessor.js   # Command parsing and execution
│   └── handlers/            # Individual command implementations
├── services/
│   ├── aiService.js         # AI API integration
│   ├── personalityManager.js # Personality CRUD operations
│   ├── webhookManager.js    # Discord webhook management
│   └── conversationManager.js # Conversation tracking
├── utils/
│   ├── logger.js           # Logging utility
│   ├── auth.js             # Authentication checks
│   └── media/              # Media processing
└── data/
    └── personalities.json   # Personality storage

```

### Key Characteristics

1. **Monolithic Design**
   - Single command processor handles all commands
   - Direct coupling between components
   - Shared state via module exports

2. **File-Based Storage**
   - `personalities.json` stores all personality data
   - No database abstraction layer
   - Direct file I/O operations

3. **Procedural Command Handling**
   ```javascript
   // Legacy command flow
   bot.js → commandProcessor.js → handlers/add.js → personalityManager.js → personalities.json
   ```

4. **Singleton Services**
   - Services exported as singleton instances
   - Tight coupling between modules
   - Difficult to test in isolation

### Current Issues
- Large files (personalityManager.js > 500 lines)
- Mixed responsibilities in single modules
- Hard-coded delays make testing slow
- Singleton patterns prevent proper dependency injection
- No clear boundaries between features

## DDD Architecture (Built, Inactive)

### Bounded Contexts

```
src/
├── contexts/
│   ├── personality/          # Personality bounded context
│   │   ├── domain/          # Domain models and logic
│   │   ├── application/     # Use cases and services
│   │   ├── infrastructure/  # Repository implementations
│   │   └── interface/       # Command handlers
│   │
│   ├── conversation/        # Conversation bounded context
│   │   └── [similar structure]
│   │
│   ├── authentication/      # Auth bounded context
│   │   └── [similar structure]
│   │
│   └── aiIntegration/      # AI service bounded context
│       └── [similar structure]
│
├── shared/                  # Shared kernel
│   ├── domain/             # Base classes, value objects
│   └── infrastructure/     # Cross-cutting concerns
│
└── adapters/               # Integration adapters
    └── CommandIntegrationAdapter.js
```

### Domain Model Examples

```javascript
// Personality Aggregate
class Personality {
  constructor(id, name, userId) {
    this.id = id;
    this.name = name;
    this.userId = userId;
    this.aliases = new Map();
    this.configuration = new PersonalityConfiguration();
  }
  
  addAlias(alias) {
    // Domain logic with invariant checking
    if (this.aliases.size >= 10) {
      throw new DomainError('Maximum aliases reached');
    }
    this.aliases.set(alias.toLowerCase(), alias);
    this.emit(new AliasAddedEvent(this.id, alias));
  }
}

// Repository Pattern
class PersonalityRepository {
  async save(personality) {
    // Abstract persistence
  }
  
  async findByName(name) {
    // Abstract retrieval
  }
}
```

### Key Improvements

1. **Bounded Contexts**
   - Clear separation of concerns
   - Each context owns its data and logic
   - Minimal coupling between contexts

2. **Repository Pattern**
   - Abstracted persistence layer
   - Easy to swap storage implementations
   - Testable with in-memory repositories

3. **Domain Events**
   - Loose coupling via events
   - Audit trail capability
   - Cache invalidation triggers

4. **Application Services**
   - Orchestrate domain operations
   - Transaction boundaries
   - Use case implementations

5. **Dependency Injection**
   - No singleton exports
   - Configurable dependencies
   - Proper unit testing

## Integration Layer

### CommandIntegrationAdapter

The adapter serves as the routing layer between legacy and DDD systems:

```javascript
class CommandIntegrationAdapter {
  async routeCommand(commandName, message, args) {
    const useNewSystem = this.shouldUseNewSystem(commandName);
    
    if (useNewSystem) {
      // Route to DDD command handler
      const handler = this.dddHandlers.get(commandName);
      return await handler.execute(message, args);
    } else {
      // Route to legacy command processor
      return await this.legacyProcessor.process(message, commandName, args);
    }
  }
  
  shouldUseNewSystem(commandName) {
    // Check feature flags
    if (!featureFlags.isEnabled('ddd.commands.enabled')) return false;
    if (!featureFlags.isEnabled('ddd.commands.integration')) return false;
    
    // Check command-specific flags
    return featureFlags.isEnabled(`ddd.commands.${commandName}`);
  }
}
```

### Feature Flag Configuration

```javascript
// All currently FALSE in production
{
  'ddd.commands.enabled': false,
  'ddd.commands.integration': false,
  'ddd.commands.personality': false,
  'ddd.personality.read': false,
  'ddd.personality.write': false,
  'ddd.personality.dual-write': false,
  'ddd.events.enabled': false
}
```

## Data Flow Comparison

### Legacy Flow (Active)

```
User Message
    │
    ▼
Discord.js Client
    │
    ▼
bot.js (message handler)
    │
    ├─► Command? ──► commandProcessor.js
    │                        │
    │                        ▼
    │                 Command Handler
    │                        │
    │                        ▼
    │                 personalityManager.js
    │                        │
    │                        ▼
    │                 personalities.json
    │
    └─► AI Response? ──► aiService.js
                              │
                              ▼
                        webhookManager.js
                              │
                              ▼
                        Discord Channel
```

### DDD Flow (Built, Ready)

```
User Message
    │
    ▼
Discord.js Client
    │
    ▼
bot.js (message handler)
    │
    ▼
CommandIntegrationAdapter
    │
    ▼
DDD Command Handler
    │
    ▼
Application Service
    │
    ├─► Domain Model
    │       │
    │       ▼
    │   Domain Events
    │
    ▼
Repository
    │
    ▼
Storage Adapter
    │
    ▼
personalities.json (or future DB)
```

## Deployment Architecture

### Current Production Setup

```
Railway Platform
    │
    ▼
┌─────────────────────────────┐
│   Node.js 22.x Process      │
│                             │
│   • Single instance         │
│   • Auto-restart on crash  │
│   • Environment variables   │
│   • Persistent volume       │
│                             │
│   Memory: ~512MB            │
│   CPU: Variable             │
│   Storage: /data volume     │
└─────────────────────────────┘
    │
    ├─► Discord API
    ├─► AI Service API
    └─► File System (/data)
```

### Environment Configuration

```bash
# Core Settings
NODE_ENV=production
DISCORD_TOKEN=[encrypted]
AI_SERVICE_URL=[api-endpoint]
AI_SERVICE_API_KEY=[encrypted]

# Feature Flags (all FALSE)
FEATURE_FLAG_DDD_COMMANDS_ENABLED=false
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=false
# ... etc

# Storage
DATA_DIR=/data
PERSONALITY_FILE=/data/personalities.json
```

## Migration Strategy

### Phase 1: Infrastructure (Complete ✓)
- Built DDD structure
- Created bounded contexts
- Implemented repositories
- Set up event system

### Phase 2: Parallel Implementation (Complete ✓)
- Implemented all commands in DDD
- Created integration adapter
- Added feature flags
- Maintained backward compatibility

### Phase 3: Testing & Validation (Complete ✓)
- 95%+ test coverage
- Integration tests passing
- Performance benchmarks met
- Production deployment ready

### Phase 4: Gradual Rollout (Current)
**Week 1**: Enable utility commands
```bash
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
```

**Week 2**: Enable auth commands
```bash
FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=true
```

**Week 3**: Enable conversation commands
```bash
FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=true
```

**Week 4-5**: Enable personality commands (high risk)
```bash
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true
FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=true  # Safety
```

### Phase 5: Legacy Removal (Future)
- Remove legacy command handlers
- Remove legacy services
- Clean up adapter code
- Celebrate! 🎉

## Key Architectural Decisions

### Why DDD?
1. **Maintainability**: Clear boundaries and responsibilities
2. **Testability**: Isolated components with dependency injection
3. **Scalability**: Easy to add new features without touching core
4. **Flexibility**: Can swap implementations (file → database)

### Why Feature Flags?
1. **Risk Mitigation**: Instant rollback capability
2. **Gradual Rollout**: Test with subset of commands
3. **A/B Testing**: Compare performance and reliability
4. **Zero Downtime**: No service interruption

### Why Keep Legacy?
1. **Stability**: Legacy system works perfectly
2. **Safety Net**: Fallback if DDD has issues
3. **Gradual Migration**: No "big bang" deployment
4. **User Trust**: No disruption to service

## Performance Considerations

### Memory Usage
- Legacy: ~480MB baseline
- DDD: Expected +10-20% (acceptable)
- Both systems loaded: +25% (temporary)

### Response Time
- Legacy: 150-200ms average
- DDD: Target ±10% of legacy
- Monitoring required during rollout

### Scalability Improvements
- Event-driven architecture enables future workers
- Repository pattern enables database migration
- Bounded contexts enable microservice extraction

## Security Architecture

### Authentication Flow
- User verification via Discord OAuth
- X-User-Auth header for AI service
- NSFW channel verification
- Role-based permissions

### Data Protection
- Sensitive data never logged
- API keys in environment variables
- Personality data access controlled
- No user data in error messages

## Monitoring & Observability

### Current Metrics
- Command execution counts
- Error rates by command
- Response time percentiles
- Memory usage trends

### DDD Additions
- Domain event stream
- Repository operation metrics
- Feature flag state tracking
- Dual-write verification logs

## Future Architecture Considerations

### Post-DDD Improvements
1. **PostgreSQL Migration**: Move from JSON files
2. **Redis Caching**: Improve performance
3. **Job Queue**: Handle long-running operations
4. **Multi-instance**: Horizontal scaling
5. **API Gateway**: External integrations

### Long-term Vision
- Microservice extraction possible
- Event sourcing for audit trail
- CQRS for read optimization
- GraphQL API for clients

---

*This document represents the current state of Tzurot's architecture as of June 18, 2025. The legacy system handles all production traffic while the DDD system awaits activation via feature flags.*