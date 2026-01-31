# System Architecture

Tzurot follows a **Domain-Driven Design (DDD)** architecture with clear separation between business logic, application orchestration, and external concerns.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [DDD Layers](#ddd-layers)
- [Domain Bounded Contexts](#domain-bounded-contexts)
- [Data Flow](#data-flow)
- [Legacy Components](#legacy-components)
- [Security Architecture](#security-architecture)
- [Performance Optimizations](#performance-optimizations)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Discord API                              │
└─────────────────────┬───────────────────┬───────────────────────┘
                      │                   │
                      ▼                   ▼
┌─────────────────────────────┐ ┌─────────────────────────────────┐
│      Discord.js Client      │ │      Webhook System             │
│         (bot.js)            │ │    (webhookManager.js)          │
└─────────────┬───────────────┘ └────────────┬────────────────────┘
              │                               │
              ▼                               │
┌─────────────────────────────────────────────▼───────────────────┐
│                   Application Layer                              │
│ ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────────┐│
│ │  Commands   │ │   Services   │ │        Event Handlers        ││
│ │(by domain)  │ │              │ │                              ││
│ └─────────────┘ └──────────────┘ └──────────────────────────────┘│
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Domain Layer                               │
│ ┌──────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐│
│ │   AI Domain  │ │Auth Domain  │ │Conversation │ │Personality  ││
│ │              │ │             │ │   Domain    │ │   Domain    ││
│ └──────────────┘ └─────────────┘ └─────────────┘ └─────────────┘│
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Adapters & Infrastructure                     │
│ ┌──────────────┐ ┌─────────────┐ ┌─────────────────────────────┐│
│ │   Discord    │ │     AI      │ │      Persistence            ││
│ │   Adapters   │ │   Adapters  │ │    (File-based)             ││
│ └──────────────┘ └─────────────┘ └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## DDD Layers

### Domain Layer (`src/domain/`)
**Pure business logic with no external dependencies**

Contains the core business concepts and rules:
- **Entities**: Personality, UserAuth, Conversation, Message
- **Value Objects**: Token, UserId, PersonalityId, AuthContext
- **Aggregates**: Business logic boundaries and consistency rules
- **Domain Events**: Capture important business occurrences
- **Domain Services**: Business logic that doesn't fit in entities

### Application Layer (`src/application/`)
**Orchestrates domain logic and coordinates workflows**

- **Application Services**: Coordinate multiple domain operations
- **Commands**: Handle user actions organized by domain
- **Event Handlers**: Process domain events
- **DTOs**: Data transfer between layers

### Adapters Layer (`src/adapters/`)
**External system integrations and abstractions**

- **Discord Adapters**: Discord API interactions
- **AI Service Adapters**: External AI API integrations  
- **Persistence Adapters**: File-based storage implementations
- **Command Integration**: Bridge to legacy command system

### Infrastructure Layer (`src/infrastructure/`)
**Framework-specific and technical concerns**

- **OAuth Services**: Authentication provider implementations
- **Archive Services**: Backup and export functionality

## Domain Bounded Contexts

### AI Domain (`domain/ai/`)
Handles all AI-related operations:
- **AIRequest**: Request lifecycle and deduplication
- **AIContent**: Multimodal content handling
- **AIModel**: AI service configuration
- **Request Deduplication**: Prevents duplicate expensive API calls

### Authentication Domain (`domain/authentication/`)
User authentication and authorization:
- **UserAuth**: User authentication state and tokens
- **Token**: OAuth token management with expiration
- **AuthContext**: Request context for permission checks
- **NSFW Status**: Age verification for content access

### Conversation Domain (`domain/conversation/`)
Chat interactions and state:
- **Conversation**: Multi-turn conversation state
- **Message**: Individual message in conversation
- **Channel Activation**: Personality activation in channels
- **Conversation Settings**: User preferences and configuration

### Personality Domain (`domain/personality/`)
AI personality management:
- **Personality**: Core personality entity with configuration
- **PersonalityProfile**: Display information (name, avatar, etc.)
- **Alias**: Alternative names for personality access
- **PersonalityConfiguration**: Behavior and permission settings

### Backup Domain (`domain/backup/`)
Data export and backup functionality:
- **BackupJob**: Scheduled backup operations
- **PersonalityData**: Data structures for export

## Data Flow

### Command Processing
```
Discord Message → bot.js → messageHandler.js
                              ↓
                   CommandIntegrationAdapter
                              ↓
                    Application Command Handler
                              ↓
                     Domain Operations
                              ↓
                    Persistence Adapters
```

### AI Interaction
```
User Message → Personality Application Service → AI Service
                                           ↓
               AI Domain ← AI Service Adapter → External AI API
                    ↓
            Domain Events → Event Handlers
                    ↓
            Webhook Manager → Discord API
```

### Authentication Flow
```
Auth Request → Auth Command → Authentication Application Service
                                       ↓
              User Auth Domain ← OAuth Token Service
                       ↓
              File Authentication Repository
```

## Legacy Components

Some components remain from the pre-DDD architecture:

### Core Business Logic (`src/core/`)
- **Profile Fetching**: External personality data retrieval
- **Conversation Management**: Legacy conversation tracking
- **Notifications**: Release notification system

### Message Handling (`src/handlers/`)
- **Message Handlers**: Legacy Discord message processing
- **Reference Handlers**: Message reply and media handling
- **DM Handlers**: Direct message processing

### Entry Points
- **bot.js**: Main Discord client and message routing
- **webhookManager.js**: Webhook creation and message sending
- **aiService.js**: Legacy AI API interface

## Security Architecture

### Authentication & Authorization
- **OAuth Token Flow**: Secure user authentication with external providers
- **Permission-based Access**: Commands require appropriate permissions
- **Token Security**: Never logged or exposed in responses
- **Rate Limiting**: Protection against abuse and API limits

### Data Privacy
- **No Sensitive Logging**: User tokens and personal data never logged
- **Minimal Data Storage**: Only essential data persisted
- **Privacy Controls**: NSFW verification and content filtering

### API Security
- **Header-based Auth**: X-User-Auth header for user context
- **Input Validation**: All user inputs sanitized and validated
- **Error Boundaries**: Prevent sensitive information leakage

## Performance Optimizations

### Caching Strategies
- **Webhook Caching**: Reuse Discord webhooks to avoid rate limits
- **Profile Caching**: Cache personality profile data to reduce API calls
- **Conversation State**: In-memory conversation tracking
- **Avatar Storage**: Local avatar serving to reduce external requests

### Deduplication
- **Request Deduplication**: Prevent duplicate AI API calls
- **Message Deduplication**: Multiple layers prevent duplicate processing
- **Event Deduplication**: Ensure domain events fire only once

### Resource Management
- **Connection Pooling**: Efficient Discord API connections
- **Memory Management**: LRU caches with size limits
- **Async Processing**: Non-blocking I/O throughout the system

## Scalability Considerations

### Current Limitations
- **File-based Storage**: JSON files limit concurrent access
- **Single Instance**: No horizontal scaling support
- **Memory State**: Conversation state lost on restart

### Future Database Migration
The DDD architecture is designed to support database migration:
- **Repository Pattern**: Abstract persistence behind interfaces
- **Domain Model Independence**: Business logic doesn't depend on storage
- **Event Sourcing Ready**: Domain events can rebuild state
- **Transaction Boundaries**: Aggregates define consistency requirements

This architecture provides a solid foundation for evolving from the current file-based system to a more scalable database-backed solution while maintaining all business logic intact.