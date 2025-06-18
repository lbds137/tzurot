# System Architecture

> **⚠️ IMPORTANT**: This document describes the **legacy architecture** currently handling 100% of production traffic. For a complete view including the built-but-inactive DDD system, see [ARCHITECTURE_OVERVIEW_2025-06-18.md](../architecture/ARCHITECTURE_OVERVIEW_2025-06-18.md).

## Table of Contents

- [Overview](#overview)
- [High-Level Architecture](#high-level-architecture)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Component Interactions](#component-interactions)
- [Design Patterns](#design-patterns)
- [Security Architecture](#security-architecture)
- [Performance Optimizations](#performance-optimizations)
- [Error Handling Strategy](#error-handling-strategy)
- [Scalability Considerations](#scalability-considerations)

## Overview

Tzurot is a Discord bot that acts as a bridge between Discord users and AI personalities. It uses Discord's webhook system to create authentic character interactions, where each AI personality appears with its own name and avatar. The bot is built using Node.js and Discord.js, following a modular architecture that separates concerns and enables maintainability.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Discord API                              │
└─────────────────────┬───────────────────┬───────────────────────┘
                      │                   │
                      ▼                   ▼
┌─────────────────────────────┐ ┌─────────────────────────────────┐
│      Discord.js Client      │ │      Webhook Clients            │
│         (bot.js)            │ │    (webhookManager.js)          │
└─────────────┬───────────────┘ └────────────┬────────────────────┘
              │                               │
              ▼                               │
┌─────────────────────────────────────────────▼───────────────────┐
│                    Message Processing Layer                      │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │   Commands   │ │   Handlers   │ │   Conversation Manager   │ │
│  └─────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer                               │
│  ┌──────────────┐ ┌─────────────────┐ ┌───────────────────────┐│
│  │  AI Service  │ │Personality Mgr  │ │ Profile Info Fetcher ││
│  └──────────────┘ └─────────────────┘ └───────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Storage Layer                               │
│  ┌──────────────┐ ┌─────────────────┐ ┌───────────────────────┐│
│  │Data Storage  │ │ Message Tracker │ │    Error Tracker    ││
│  └──────────────┘ └─────────────────┘ └───────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Bot Core (`src/bot.js`)
The main entry point that handles Discord client events and orchestrates message processing.

**Responsibilities:**
- Initialize Discord.js client
- Handle message events (messages, edits, deletions)
- Route messages to appropriate handlers
- Manage bot lifecycle (ready, error, disconnect events)
- Support both guild channels and direct messages (DMs)

**Key Features:**
- Message deduplication to prevent duplicate responses
- Thread support for conversations in threads
- DM handling with special webhook fallback
- Graceful error handling and recovery

### 2. Command System (`src/commands/`)
Modular command processing system with middleware support.

**Structure:**
```
commands/
├── index.js          # Command dispatcher
├── handlers/         # Individual command implementations
├── middleware/       # Pre-processing middleware
└── utils/           # Command utilities
```

**Middleware Pipeline:**
1. **Authentication Middleware** - Validates user authentication
2. **Permissions Middleware** - Checks Discord permissions
3. **Deduplication Middleware** - Prevents duplicate command execution
4. **Command Handler** - Executes the specific command

### 3. Message Handlers (`src/handlers/`)
Specialized handlers for different message types and scenarios.

**Components:**
- **messageHandler.js** - Primary message processing logic
- **dmHandler.js** - Direct message handling
- **referenceHandler.js** - Reply/reference message handling
- **personalityHandler.js** - Personality interaction logic
- **errorHandler.js** - Centralized error handling
- **messageTrackerHandler.js** - Message tracking for conversations

### 4. Webhook Manager (`src/webhookManager.js`)
Manages Discord webhooks for personality messages.

**Features:**
- Webhook creation and caching per channel
- Message splitting for content exceeding Discord limits (2000 chars)
- Media attachment handling (images and audio)
- Username suffix support for personality identification
- DM fallback when webhooks aren't available

**Webhook Naming Pattern:**
```
"PersonalityDisplayName | suffix"
```

### 5. AI Service (`src/aiService.js`)
Interface layer for AI API communication.

**Responsibilities:**
- Send requests to AI service with proper headers
- Handle authentication and authorization
- Process multimodal content (text, images, audio)
- Implement retry logic with exponential backoff
- Sanitize and validate responses

**Security Features:**
- Authentication bypass prevention
- Authorization validation
- URL validation for safety
- Content sanitization

### 6. Personality Manager (`src/personalityManager.js`)
Manages AI personality registration and metadata.

**Features:**
- Add/remove personalities per user
- Alias management for easy reference
- Profile information caching
- Personality ownership tracking
- Data persistence to disk

**Data Structure:**
```javascript
{
  "personality-name": {
    "fullName": "personality-name",
    "addedBy": ["userId1", "userId2"],
    "aliases": {
      "userId1": ["alias1", "alias2"]
    },
    "displayName": "Personality Display Name",
    "avatarUrl": "https://..."
  }
}
```

### 7. Conversation Manager (`src/conversationManager.js`)
Tracks active conversations and maintains context.

**Features:**
- Map message IDs to personality data
- Track active conversations per user
- Channel-wide personality activation
- Auto-response mode management
- Conversation timeout handling (30 minutes)

### 8. Profile Info Fetcher (`src/profileInfoFetcher.js`)
Fetches and caches personality profile information.

**Features:**
- Dynamic avatar URL fetching
- Display name retrieval
- 24-hour cache for performance
- Fallback handling for unavailable profiles
- Rate limit aware

### 9. Authentication System (`src/auth.js`)
Manages user authentication with the AI service.

**Features:**
- OAuth-like flow for user authorization
- Token storage and validation
- Automatic token expiration (30 days)
- Secure code submission (DM only)
- Authorization status tracking

### 10. Utility Modules (`src/utils/`)
Supporting utilities for various functionalities.

**Key Utilities:**
- **embedUtils.js** - Discord embed creation and parsing
- **mediaHandler.js** - Centralized media processing
- **contentSimilarity.js** - Duplicate content detection
- **rateLimiter.js** - Request rate limiting
- **urlValidator.js** - URL safety validation
- **webhookUserTracker.js** - Webhook message tracking
- **errorTracker.js** - Error accumulation and tracking

## Data Flow

### Standard Message Flow

```
User Message → Discord API → Discord.js Client → Message Event Handler
                                                          │
                                                          ▼
                                              Message Type Detection
                                             /            │            \
                                            /             │             \
                                     Command          Mention/Reply    Channel Active
                                        │                 │                 │
                                        ▼                 ▼                 ▼
                                Command System    Personality Lookup   Get Active
                                        │                 │            Personality
                                        ▼                 └─────────┬───────┘
                                   Execute                          │
                                   Command                          ▼
                                                            AI Service Call
                                                                    │
                                                                    ▼
                                                            Webhook Manager
                                                                    │
                                                                    ▼
                                                         Discord Webhook API
                                                                    │
                                                                    ▼
                                                         Message Sent as
                                                          Personality
```

### DM Message Flow

```
DM Message → Discord API → Discord.js Client → DM Handler
                                                    │
                                                    ▼
                                           Check Conversation
                                              Context
                                                    │
                                                    ▼
                                            AI Service Call
                                                    │
                                                    ▼
                                         Standard Reply (no webhook)
                                           with Embed for
                                          Personality Info
```

## Component Interactions

### Message Processing Sequence

1. **Initial Receipt**
   - Discord.js client receives message event
   - Message passed to bot.js event handler
   - Deduplication check performed

2. **Message Classification**
   - Command detection (prefix check)
   - Mention detection (@personality)
   - Reply detection (reference to personality message)
   - Active conversation check
   - Channel activation check

3. **Processing Path Selection**
   - Commands → Command System
   - Mentions/Replies → Personality Handler
   - Active Conversations → Conversation Manager
   - Channel Activation → Direct AI Service

4. **AI Interaction**
   - Build request with context headers
   - Include user ID and channel ID
   - Send to AI Service
   - Handle response or errors

5. **Response Delivery**
   - Format response for Discord
   - Split if exceeding character limits
   - Send via webhook (guild) or standard message (DM)
   - Update conversation tracking

### Webhook Management Flow

```
Need to Send Message
        │
        ▼
Check Webhook Cache
        │
    ┌───┴───┐
    │Found? │
    └───┬───┘
    No  │  Yes
    │   │   │
    ▼   │   ▼
Create  │  Use Cached
Webhook │  Webhook
    │   │   │
    └───┼───┘
        │
        ▼
Send Message(s)
        │
        ▼
Handle Media
Attachments
```

## Design Patterns

### 1. Middleware Pattern
Used in the command system for composable pre-processing.

```javascript
// Middleware pipeline
message → auth → permissions → deduplication → handler
```

### 2. Factory Pattern
Used for creating command handlers and message processors.

### 3. Singleton Pattern
Used for:
- Message tracker
- Error tracker
- Command registry
- Webhook cache

### 4. Observer Pattern
Event-driven architecture for Discord events.

### 5. Strategy Pattern
Different handling strategies for:
- Guild messages vs DMs
- Commands vs conversations
- Media types (audio, image)

## Security Architecture

### Authentication Flow
```
User → !tz auth start → Get Auth URL → Visit URL → Get Code
                                              │
                                              ▼
                                    Submit Code (DM only)
                                              │
                                              ▼
                                      Validate & Store Token
                                              │
                                              ▼
                                    Authenticated Requests
```

### Security Layers

1. **Command Level**
   - Permission checking
   - Input validation
   - Rate limiting

2. **API Level**
   - Authentication token validation
   - Authorization header checking
   - Request sanitization

3. **Content Level**
   - URL validation
   - Content length limits
   - Webhook name validation

4. **Storage Level**
   - No sensitive data in logs
   - Token encryption consideration
   - File permission management

## Performance Optimizations

### 1. Caching Strategy
- **Webhook Cache**: Reduces Discord API calls
- **Profile Cache**: 24-hour TTL for avatar/display names
- **Message Tracking**: In-memory cache with size limits
- **Command Registry**: Pre-loaded command modules

### 2. Rate Limiting
- User-level rate limits
- Channel-level rate limits
- Global API rate limits
- Exponential backoff for retries

### 3. Message Deduplication
Multiple layers prevent duplicate processing:
- Message ID tracking
- Content similarity detection
- Nonce checking for webhooks
- Command execution tracking

### 4. Efficient Data Structures
- Maps for O(1) lookups
- Sets for unique tracking
- Circular buffers for error tracking

## Error Handling Strategy

### Error Categories

1. **Recoverable Errors**
   - API timeouts → Retry with backoff
   - Rate limits → Queue and retry
   - Network errors → Attempt recovery

2. **User Errors**
   - Invalid commands → Clear error message
   - Missing permissions → Helpful explanation
   - Bad input → Validation feedback

3. **System Errors**
   - Critical failures → Log and alert
   - Webhook failures → Fallback to standard messages
   - Storage errors → In-memory fallback

### Error Propagation
```
Component Error → Local Handler → Error Tracker → User Notification
                                        │
                                        ▼
                                  Monitoring/Logs
```

## Scalability Considerations

### Current Limitations
- File-based storage (personalities.json, aliases.json)
- In-memory conversation tracking
- Single-instance design
- Synchronous file I/O

### Future Scaling Path

1. **Database Migration**
   - Replace JSON files with database
   - Implement connection pooling
   - Add caching layer (Redis)

2. **Horizontal Scaling**
   - Stateless design enables multi-instance
   - Shared cache/database required
   - Load balancer for webhook callbacks

3. **Performance Monitoring**
   - Metrics collection
   - Performance profiling
   - Resource usage tracking

4. **Optimization Opportunities**
   - Lazy loading of commands
   - Streaming responses
   - Worker threads for CPU-intensive tasks
   - Message queue for async processing

## Module Dependencies

```
bot.js
├── commands/
├── handlers/
│   ├── messageHandler
│   ├── dmHandler
│   └── errorHandler
├── webhookManager
├── conversationManager
├── personalityManager
├── aiService
└── utils/

aiService.js
├── auth
├── logger
└── utils/urlValidator

webhookManager.js
├── utils/media/
├── logger
└── Discord.js

personalityManager.js
├── dataStorage
├── profileInfoFetcher
└── logger
```

## Configuration Architecture

### Environment Variables
Centralized in `config.js`, loaded from `.env`:
- `DISCORD_TOKEN` - Bot authentication
- `PREFIX` - Command prefix
- `SERVICE_API_KEY` - AI service authentication
- `SERVICE_API_ENDPOINT` - AI service URL
- `OWNER_ID` - Bot owner Discord ID

### Runtime Configuration
- Personality data in `data/personalities.json`
- Alias mappings in `data/aliases.json`
- Error tracking in memory
- Conversation state in memory

## Testing Architecture

### Test Structure
```
tests/
├── unit/          # Unit tests for individual components
├── mocks/         # Shared mock implementations
├── utils/         # Test utilities and helpers
└── setup.js       # Jest configuration
```

### Test Coverage Areas
- Command processing
- Message handling
- Authentication flow
- Error scenarios
- Media processing
- Deduplication logic

See [TESTING.md](../testing/README.md) for detailed testing documentation.