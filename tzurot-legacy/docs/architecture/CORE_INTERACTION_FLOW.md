# Core Interaction Flow

## Overview
Tzurot is a Discord bot that acts as a proxy between Discord users and an AI service. It uses webhooks to represent different AI personalities with unique display names and avatars.

## Core Flow

```
User → Discord Bot → AI Service → Discord Webhook
```

### Detailed Steps

1. **User Input**
   - User types a message mentioning a personality (e.g., `@PersonalityName hello`)
   - Or replies to a previous personality message
   - Or uses commands (`!tz add personality-name`)

2. **Bot Processing**
   - Bot receives Discord message event
   - Identifies which personality to use (from mention, reply, or active conversation)
   - Extracts message content and context

3. **AI Service Call**
   - Bot sends request to AI service with:
     - Personality name (NOT prompt or model configuration)
     - User message
     - Conversation context
     - User authentication header (X-User-Auth)

4. **AI Service Response**
   - Service returns:
     - Response text
     - Profile data: displayName, avatarUrl, errorMessage (if applicable)

5. **Discord Output**
   - Bot creates/retrieves webhook for the channel
   - Sends message via webhook with:
     - Username: displayName from API
     - Avatar: avatarUrl from API
     - Content: AI response text

## Key Domain Concepts

### Personality
- **What it is**: A name that maps to AI profile data
- **What it's NOT**: A complex entity with prompts, models, or configurations
- **Stored data**: 
  - fullName (the personality identifier)
  - addedBy (Discord user ID who added it)
  - aliases (alternative names)

### Profile Data (From API)
- **displayName**: The name shown in Discord
- **avatarUrl**: The avatar image URL
- **errorMessage**: Error from AI service (if any)
- **Retrieved via**: API calls using personality name

### Critical API Methods
These MUST be called to get profile data:
- `getProfileDisplayName(personalityName)`
- `getProfileAvatarUrl(personalityName)`
- `getProfileErrorMessage(personalityName)`

## Implementation Requirements

1. **Simplicity First**
   - No event sourcing
   - No value objects
   - No complex domain models
   - Just simple data structures and API calls

2. **API Abstraction**
   - Create interface to support multiple backends
   - Current: External AI service (unnamed for compliance)
   - Future: Self-hosted system

3. **Error Handling**
   - Handle API failures gracefully
   - Show user-friendly error messages
   - Implement retries with backoff

4. **Performance**
   - Cache webhooks per channel
   - Cache profile data with TTL
   - Minimize API calls

## What We're NOT Building
- Complex domain models
- Event sourcing systems
- Repository patterns with hydration
- Auto-generated IDs (use personality names)
- Prompts or model configurations in the bot