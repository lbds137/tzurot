# Architecture Documentation Update Needed

**Date**: June 18, 2025

## Issue

The current `ARCHITECTURE.md` file only describes the legacy system and doesn't reflect the Domain-Driven Design (DDD) implementation that has been built.

## What's Missing

1. **DDD Layer Architecture**
   - Domain layer (entities, value objects, aggregates)
   - Application layer (services, commands, events)
   - Infrastructure layer (adapters, repositories)
   - No mention of bounded contexts

2. **Dual System Architecture**
   - CommandIntegrationAdapter routing
   - Feature flag system
   - Parallel operation of legacy and DDD systems

3. **New Components**
   - ApplicationBootstrap
   - DomainEventBus
   - Repository pattern implementations
   - Command abstraction layer

4. **HTTP Server**
   - Avatar serving system on port 3000
   - Not mentioned in current architecture

## Recommended Updates

1. Add a section on "Migration Architecture" showing both systems
2. Create separate diagrams for:
   - Current production architecture (legacy)
   - Target DDD architecture
   - Transition state with both systems
3. Document the feature flag routing mechanism
4. Include the new bounded contexts:
   - Personality Domain
   - Conversation Domain
   - Authentication Domain
   - AI Integration Domain

## Example Addition

```
## Dual System Architecture (Current State)

During the DDD migration, the system operates with two parallel architectures:

### Legacy System
- Original command handlers in `src/commands/handlers/`
- Direct coupling between components
- File-based persistence

### DDD System (Built but Inactive)
- Domain models in `src/domain/`
- Application services in `src/application/`
- Adapters in `src/adapters/`
- Feature flag controlled routing

### Routing Logic
```
Message → messageHandler → CommandIntegrationAdapter
                                ↓
                    Check Feature Flag
                    ↙               ↘
            Legacy System        DDD System
            (Active)            (Inactive)
```

## Note

This is a placeholder document to track that ARCHITECTURE.md needs updating. Once the DDD system is activated and proven stable, the architecture documentation should be completely rewritten to reflect the new design.