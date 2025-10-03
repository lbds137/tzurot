# API Reference

This document provides a comprehensive reference for all public modules and interfaces in Tzurot.

## Table of Contents

- [Core Modules](#core-modules)
  - [bot.js](#botjs)
  - [aiService.js](#aiservicejs)
  - [auth.js](#authjs)
  - [personalityManager.js](#personalitymanagerjs)
  - [webhookManager.js](#webhookmanagerjs)
  - [conversationManager.js](#conversationmanagerjs)
- [Command System](#command-system)
  - [Command Structure](#command-structure)
  - [Command Registry](#command-registry)
  - [Middleware System](#middleware-system)
- [Handlers](#handlers)
  - [messageHandler.js](#messagehandlerjs)
  - [dmHandler.js](#dmhandlerjs)
  - [referenceHandler.js](#referencehandlerjs)
  - [errorHandler.js](#errorhandlerjs)
- [Utilities](#utilities)
  - [Media Handlers](#media-handlers)
  - [Embed Utilities](#embed-utilities)
  - [Content Utilities](#content-utilities)
  - [Rate Limiting](#rate-limiting)
- [Data Storage](#data-storage)
- [Events](#events)
- [Error Types](#error-types)

## Core Modules

### bot.js

The main Discord bot client and event handler.

#### Exports

```javascript
module.exports = client; // Discord.Client instance
```

#### Events Emitted

- `ready` - Bot connected to Discord
- `messageCreate` - New message received
- `messageUpdate` - Message edited
- `messageDelete` - Message deleted
- `error` - Client error occurred

#### Key Properties

```javascript
client.user        // Bot user information
client.guilds      // Collection of guilds
client.channels    // Collection of channels
```

### aiService.js

Handles communication with the AI service API.

#### Functions

##### sendMessageToAI(prompt, personalityName, userId, channelId)

Sends a message to the AI service and returns the response.

**Parameters:**
- `prompt` (string) - The user's message
- `personalityName` (string) - Full name of the personality
- `userId` (string) - Discord user ID
- `channelId` (string) - Discord channel ID

**Returns:** Promise<string> - AI response text

**Throws:**
- `AuthenticationError` - Invalid or missing authentication
- `APIError` - AI service returned an error
- `TimeoutError` - Request timed out

**Example:**
```javascript
const response = await sendMessageToAI(
  "Hello, how are you?",
  "friendly-assistant",
  "123456789",
  "987654321"
);
```

##### sanitizeResponse(response)

Sanitizes AI responses to prevent exploits.

**Parameters:**
- `response` (string) - Raw AI response

**Returns:** string - Sanitized response

### auth.js

Manages user authentication for AI service access.

#### Functions

##### startAuthProcess(userId)

Initiates authentication flow for a user.

**Parameters:**
- `userId` (string) - Discord user ID

**Returns:** Object
```javascript
{
  url: "https://auth.example.com/authorize?...",
  state: "random-state-string"
}
```

##### submitAuthCode(userId, code)

Exchanges authorization code for access token.

**Parameters:**
- `userId` (string) - Discord user ID
- `code` (string) - Authorization code

**Returns:** Promise<boolean> - Success status

**Throws:**
- `InvalidCodeError` - Code is invalid or expired

##### isAuthenticated(userId)

Checks if user has valid authentication.

**Parameters:**
- `userId` (string) - Discord user ID

**Returns:** boolean

##### getAuthToken(userId)

Retrieves user's authentication token.

**Parameters:**
- `userId` (string) - Discord user ID

**Returns:** string | null - Token or null if not authenticated

**Throws:**
- `TokenExpiredError` - Token has expired

##### revokeAuth(userId)

Removes user's authentication.

**Parameters:**
- `userId` (string) - Discord user ID

**Returns:** boolean - Success status

### personalityManager.js

Manages AI personality registration and metadata.

#### Functions

##### addPersonality(userId, personalityName, alias)

Adds a personality to user's collection.

**Parameters:**
- `userId` (string) - Discord user ID
- `personalityName` (string) - Full personality name
- `alias` (string, optional) - Nickname for the personality

**Returns:** Promise<Object>
```javascript
{
  success: true,
  personality: {
    fullName: "personality-name",
    displayName: "Display Name",
    avatarUrl: "https://..."
  }
}
```

##### removePersonality(userId, personalityNameOrAlias)

Removes a personality from user's collection.

**Parameters:**
- `userId` (string) - Discord user ID
- `personalityNameOrAlias` (string) - Personality name or alias

**Returns:** boolean - Success status

##### getPersonality(personalityNameOrAlias, userId)

Retrieves personality information.

**Parameters:**
- `personalityNameOrAlias` (string) - Name or alias to look up
- `userId` (string, optional) - Limit search to user's personalities

**Returns:** Object | null
```javascript
{
  fullName: "personality-name",
  displayName: "Display Name",
  avatarUrl: "https://...",
  aliases: ["alias1", "alias2"]
}
```

##### listPersonalities(userId, page)

Lists user's personalities with pagination.

**Parameters:**
- `userId` (string) - Discord user ID
- `page` (number) - Page number (default: 1)

**Returns:** Object
```javascript
{
  personalities: [...],
  totalCount: 25,
  page: 1,
  totalPages: 3
}
```

##### addAlias(userId, personalityName, newAlias)

Adds an alias to existing personality.

**Parameters:**
- `userId` (string) - Discord user ID
- `personalityName` (string) - Personality name
- `newAlias` (string) - New alias to add

**Returns:** boolean - Success status

### webhookManager.js

Manages Discord webhooks for personality messages.

#### Functions

##### sendWebhookMessage(channel, displayName, avatarUrl, content, attachments)

Sends a message using a webhook.

**Parameters:**
- `channel` (TextChannel) - Discord channel
- `displayName` (string) - Name to display
- `avatarUrl` (string) - Avatar URL
- `content` (string) - Message content
- `attachments` (Array) - File attachments

**Returns:** Promise<Message[]> - Array of sent messages

##### getOrCreateWebhook(channel)

Gets existing or creates new webhook for channel.

**Parameters:**
- `channel` (TextChannel) - Discord channel

**Returns:** Promise<Webhook> - Discord webhook instance

##### handleDMResponse(message, displayName, avatarUrl, content)

Handles responses in DM channels (no webhooks).

**Parameters:**
- `message` (Message) - Original message
- `displayName` (string) - Personality display name
- `avatarUrl` (string) - Personality avatar
- `content` (string) - Response content

**Returns:** Promise<Message> - Sent message

### conversationManager.js

Tracks active conversations and personality interactions.

#### Functions

##### startConversation(userId, channelId, personalityName, messageId)

Starts a new conversation.

**Parameters:**
- `userId` (string) - Discord user ID
- `channelId` (string) - Discord channel ID
- `personalityName` (string) - Active personality
- `messageId` (string) - Initial message ID

**Returns:** void

##### getActivePersonality(userId, channelId)

Gets user's active personality in channel.

**Parameters:**
- `userId` (string) - Discord user ID
- `channelId` (string) - Discord channel ID

**Returns:** string | null - Personality name or null

##### setAutoResponse(userId, enabled)

Toggles auto-response mode for user.

**Parameters:**
- `userId` (string) - Discord user ID
- `enabled` (boolean) - Enable/disable state

**Returns:** void

##### activatePersonalityForChannel(channelId, personalityName)

Activates personality for entire channel.

**Parameters:**
- `channelId` (string) - Discord channel ID
- `personalityName` (string) - Personality to activate

**Returns:** void

##### clearConversation(userId, channelId)

Clears user's active conversation.

**Parameters:**
- `userId` (string) - Discord user ID
- `channelId` (string) - Discord channel ID

**Returns:** void

## Command System

### Command Structure

Each command module must export:

```javascript
module.exports = {
  meta: {
    name: 'commandname',           // Command name (required)
    description: 'Description',    // Help text (required)
    usage: 'commandname [args]',   // Usage syntax (required)
    aliases: ['alias1', 'alias2'], // Alternative names (optional)
    permissions: ['PERMISSION'],   // Required permissions (optional)
    cooldown: 5000                 // Cooldown in ms (optional)
  },
  execute: async (message, args) => {
    // Command logic
    // Return result object or throw error
  }
};
```

### Command Registry

#### Functions

##### register(command)

Registers a new command.

**Parameters:**
- `command` (Object) - Command module

**Returns:** void

##### get(commandName)

Retrieves command by name or alias.

**Parameters:**
- `commandName` (string) - Command name or alias

**Returns:** Object | null - Command module or null

##### getAllCommands()

Gets all registered commands.

**Returns:** Map<string, Object> - Command map

### Middleware System

Middleware functions run before command execution:

```javascript
module.exports = async (message, args, next) => {
  // Middleware logic
  
  // Continue to next middleware
  return next();
  
  // Or halt execution
  throw new Error('Middleware rejected');
};
```

#### Built-in Middleware

1. **Authentication Middleware**
   - Validates user authentication
   - Adds `message.isAuthenticated` property

2. **Permissions Middleware**
   - Checks Discord permissions
   - Validates command requirements

3. **Deduplication Middleware**
   - Prevents duplicate command execution
   - Tracks by message ID

## Handlers

### messageHandler.js

Main message processing logic.

#### handleMessage(message)

Processes incoming Discord messages.

**Parameters:**
- `message` (Message) - Discord message object

**Returns:** Promise<void>

**Flow:**
1. Check if message should be processed
2. Detect message type (command, mention, reply)
3. Route to appropriate handler
4. Handle errors gracefully

### dmHandler.js

Handles direct message interactions.

#### handleDM(message)

Processes DM messages.

**Parameters:**
- `message` (Message) - Discord DM message

**Returns:** Promise<void>

**Features:**
- No webhook support (uses embeds)
- Auth code submission
- Personal conversations only

### referenceHandler.js

Handles message replies and references.

#### handleReference(message)

Processes messages with references.

**Parameters:**
- `message` (Message) - Message with reference

**Returns:** Promise<Object | null>
```javascript
{
  success: true,
  personalityName: "personality-name",
  originalContent: "referenced message content"
}
```

### errorHandler.js

Centralized error handling.

#### handleError(error, context)

Processes and logs errors.

**Parameters:**
- `error` (Error) - Error object
- `context` (Object) - Error context

**Returns:** void

#### sendErrorMessage(channel, userMessage)

Sends user-friendly error message.

**Parameters:**
- `channel` (TextChannel) - Discord channel
- `userMessage` (string) - Error message for user

**Returns:** Promise<Message>

## Utilities

### Media Handlers

#### mediaHandler.js

Central media processing interface.

##### processMedia(attachments)

Processes message attachments.

**Parameters:**
- `attachments` (Collection) - Discord attachments

**Returns:** Promise<Object>
```javascript
{
  images: ["data:image/png;base64,..."],
  audio: ["https://..."],
  other: []
}
```

#### imageHandler.js

##### convertImageToBase64(url, options)

Converts image URL to base64.

**Parameters:**
- `url` (string) - Image URL
- `options` (Object) - Processing options

**Returns:** Promise<string> - Base64 data URL

#### audioHandler.js

##### processAudioUrl(url)

Processes audio URL for Discord.

**Parameters:**
- `url` (string) - Audio URL

**Returns:** Promise<Object>
```javascript
{
  attachment: Buffer,
  name: "audio.mp3"
}
```

### Embed Utilities

#### embedUtils.js

##### createPersonalityEmbed(displayName, avatarUrl, content)

Creates embed for personality messages.

**Parameters:**
- `displayName` (string) - Personality name
- `avatarUrl` (string) - Avatar URL
- `content` (string) - Message content

**Returns:** EmbedBuilder

##### parseEmbedsToText(embeds)

Extracts text from Discord embeds.

**Parameters:**
- `embeds` (Array) - Discord embeds

**Returns:** string - Combined text content

### Content Utilities

#### contentSimilarity.js

##### checkSimilarity(content1, content2, threshold)

Checks content similarity for deduplication.

**Parameters:**
- `content1` (string) - First content
- `content2` (string) - Second content
- `threshold` (number) - Similarity threshold (0-1)

**Returns:** boolean - Are contents similar

#### urlValidator.js

##### isValidUrl(url)

Validates URL safety.

**Parameters:**
- `url` (string) - URL to validate

**Returns:** boolean - Is URL safe

##### extractUrls(content)

Extracts URLs from content.

**Parameters:**
- `content` (string) - Text content

**Returns:** Array<string> - Found URLs

### Rate Limiting

#### rateLimiter.js

##### checkRateLimit(userId, action)

Checks if action is rate limited.

**Parameters:**
- `userId` (string) - User ID
- `action` (string) - Action type

**Returns:** Object
```javascript
{
  limited: boolean,
  resetAt: Date,
  remaining: number
}
```

## Data Storage

### dataStorage.js

File-based storage interface.

#### Functions

##### saveData(filename, data)

Saves data to JSON file.

**Parameters:**
- `filename` (string) - File name (without path)
- `data` (Object) - Data to save

**Returns:** Promise<void>

##### loadData(filename, defaultValue)

Loads data from JSON file.

**Parameters:**
- `filename` (string) - File name
- `defaultValue` (any) - Default if file missing

**Returns:** Promise<any> - Loaded data

##### ensureDataDirectory()

Ensures data directory exists.

**Returns:** Promise<void>

## Events

### Custom Events

The bot emits custom events for extensibility:

```javascript
// Personality added
client.emit('personalityAdded', {
  userId,
  personalityName,
  personality
});

// Conversation started
client.emit('conversationStarted', {
  userId,
  channelId,
  personalityName
});

// Error occurred
client.emit('botError', {
  error,
  context,
  severity
});
```

### Event Listeners

```javascript
// Listen for custom events
client.on('personalityAdded', (data) => {
  console.log(`New personality: ${data.personalityName}`);
});
```

## Error Types

### Custom Error Classes

```javascript
class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

class APIError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
  }
}

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class PermissionError extends Error {
  constructor(message, required) {
    super(message);
    this.name = 'PermissionError';
    this.required = required;
  }
}
```

### Error Handling Patterns

```javascript
try {
  const result = await someOperation();
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Handle auth errors
  } else if (error instanceof APIError) {
    // Handle API errors
  } else {
    // Handle unexpected errors
  }
}
```

## Best Practices

### Module Usage

1. **Always handle promises**
   ```javascript
   // Good
   try {
     await sendMessageToAI(...);
   } catch (error) {
     handleError(error);
   }
   ```

2. **Validate inputs**
   ```javascript
   if (!userId || !personalityName) {
     throw new ValidationError('Missing required parameters');
   }
   ```

3. **Use appropriate error types**
   ```javascript
   throw new PermissionError(
     'Manage Messages permission required',
     ['MANAGE_MESSAGES']
   );
   ```

4. **Clean up resources**
   ```javascript
   const webhook = await getOrCreateWebhook(channel);
   try {
     await webhook.send(content);
   } finally {
     // Cleanup if needed
   }
   ```

### Performance Considerations

1. **Cache expensive operations**
   - Webhook lookups
   - Profile information
   - Permission checks

2. **Batch operations**
   - Multiple messages
   - Bulk data updates

3. **Implement timeouts**
   - API requests
   - Long operations

4. **Monitor memory usage**
   - Clear old cache entries
   - Limit collection sizes