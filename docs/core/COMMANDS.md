# Tzurot Bot Commands

This document provides comprehensive documentation for all Tzurot bot commands, including syntax, permissions, examples, and detailed usage information.

## Table of Contents

- [Command Prefix](#command-prefix)
- [Command Categories](#command-categories)
  - [Personality Management](#personality-management)
  - [Conversation Control](#conversation-control)
  - [Authentication](#authentication)
  - [System Commands](#system-commands)
  - [Administrator Commands](#administrator-commands)
- [Command Details](#command-details)
- [Interaction Methods](#interaction-methods)
- [Permission Levels](#permission-levels)

## Command Prefix

All commands must be prefixed with `!tz` (configurable via environment variable `PREFIX`).

Example: `!tz help`, `!tz add personality-name`

## Command Categories

### Personality Management

Commands for managing AI personalities in your personal collection.

| Command | Description | Permissions |
|---------|-------------|-------------|
| `add` | Add a new AI personality | None |
| `remove` | Remove a personality from your collection | None |
| `list` | List your added personalities | None |
| `alias` | Add an alias to a personality | None |
| `info` | Show detailed personality information | None |

### Conversation Control

Commands for managing conversations and interaction modes.

| Command | Description | Permissions |
|---------|-------------|-------------|
| `activate` | Activate a personality for the entire channel | Manage Messages |
| `deactivate` | Deactivate channel-wide personality | Manage Messages |
| `reset` | Clear active conversation | None |
| `autorespond` | Toggle personal auto-response mode | None |

### Authentication

Commands for managing authentication with the AI service.

| Command | Description | Permissions |
|---------|-------------|-------------|
| `auth` | Manage authentication status | None |
| `verify` | Verify your authentication | None |

### System Commands

General system and utility commands.

| Command | Description | Permissions |
|---------|-------------|-------------|
| `help` | Display help information | None |
| `ping` | Test bot responsiveness | None |
| `status` | Display bot status and statistics | None |
| `purgbot` | Purge bot messages from DM history | None (DM only) |

### Administrator Commands

Commands restricted to bot administrators.

| Command | Description | Permissions |
|---------|-------------|-------------|
| `debug` | Display debug information | Administrator |

## Command Details

### Personality Management Commands

#### `add` (alias: `create`)
Add a new AI personality to your collection.

**Syntax:** `!tz add <personality_name> [alias]`

**Parameters:**
- `personality_name` (required): The exact name of the personality on the AI service
- `alias` (optional): A nickname for easier reference

**Examples:**
```
!tz add lilith-tzel-shani
!tz add lilith-tzel-shani lilith
!tz create complex-personality-name cp
```

**Notes:**
- Personality names are case-sensitive
- Aliases are case-insensitive
- Each user maintains their own personality collection
- Duplicate personalities are not allowed

---

#### `remove` (alias: `delete`)
Remove a personality from your collection.

**Syntax:** `!tz remove <personality_or_alias>`

**Parameters:**
- `personality_or_alias`: The personality name or its alias

**Examples:**
```
!tz remove lilith
!tz delete complex-personality-name
```

**Notes:**
- Removes the personality from your personal collection only
- Does not affect other users' collections

---

#### `list`
Display your added personalities with pagination support.

**Syntax:** `!tz list [page]`

**Parameters:**
- `page` (optional): Page number for pagination (default: 1)

**Examples:**
```
!tz list
!tz list 2
```

**Notes:**
- Shows 10 personalities per page
- Displays personality names, aliases, and avatar URLs
- Shows display names when available

---

#### `alias`
Add an alias to an existing personality.

**Syntax:** `!tz alias <personality> <new_alias>`

**Parameters:**
- `personality`: The personality name or existing alias
- `new_alias`: The new alias to add

**Examples:**
```
!tz alias lilith-tzel-shani lil
!tz alias complex-name cn
```

**Notes:**
- Aliases must be unique across your collection
- Multiple aliases per personality are supported

---

#### `info`
Display detailed information about a personality.

**Syntax:** `!tz info <personality_or_alias>`

**Parameters:**
- `personality_or_alias`: The personality name or alias

**Examples:**
```
!tz info lilith
!tz info complex-personality-name
```

**Notes:**
- Shows full name, display name, aliases, and avatar
- Indicates if profile information is cached

### Conversation Control Commands

#### `activate`
Activate a personality for the entire channel (moderator only).

**Syntax:** `!tz activate <personality_or_alias>`

**Parameters:**
- `personality_or_alias`: The personality to activate

**Required Permissions:** Manage Messages + NSFW Channel

**Examples:**
```
!tz activate lilith
!tz activate friendly-assistant
```

**Notes:**
- Makes the personality respond to ALL messages in the channel
- Remains active until deactivated
- Only one personality can be active per channel
- Useful for dedicated AI character channels

---

#### `deactivate`
Deactivate the channel-wide personality.

**Syntax:** `!tz deactivate`

**Required Permissions:** Manage Messages

**Examples:**
```
!tz deactivate
```

**Notes:**
- Stops the active personality from responding to all messages
- Users can still interact via mentions and replies

---

#### `reset`
Clear your active conversation with a personality.

**Syntax:** `!tz reset`

**Examples:**
```
!tz reset
```

**Notes:**
- Only affects your personal conversation
- Does not affect channel-wide activation
- Useful when auto-response is enabled

---

#### `autorespond`
Toggle personal auto-response mode.

**Syntax:** `!tz autorespond <on|off|status>`

**Parameters:**
- `on`: Enable auto-response
- `off`: Disable auto-response
- `status`: Check current status

**Examples:**
```
!tz autorespond on
!tz autorespond off
!tz autorespond status
```

**Notes:**
- When enabled, personalities continue responding to your messages automatically
- Times out after 30 minutes of inactivity
- Only affects your messages, not other users
- Disabled by default

### Authentication Commands

#### `auth`
Manage your authentication with the AI service.

**Syntax:** `!tz auth <subcommand>`

**Subcommands:**
- `start`: Begin authentication process and get authorization URL
- `code <code>`: Submit authorization code (DM only for security)
- `status`: Check authentication status
- `revoke`: Remove your authorization
- `cleanup`: Clean up expired authentication tokens (admin only)

**Examples:**
```
!tz auth start
!tz auth code ABC123DEF456  (in DM only)
!tz auth status
!tz auth revoke
!tz auth cleanup            (admin only)
```

**Security Notes:**
- Authorization codes must be submitted via DM only
- Codes in public channels are automatically deleted
- Authentication tokens expire after 30 days

---

#### `verify`
Verify your age to use AI personalities in Direct Messages.

**Syntax:** `!tz verify`

**Aliases:** `nsfw`

**Examples:**
```
!tz verify
!tz nsfw
```

**Notes:**
- Required for using personalities in DMs
- Age verification is persistent
- Only needs to be done once

### System Commands

#### `help`
Display help information for commands.

**Syntax:** `!tz help [command]`

**Parameters:**
- `command` (optional): Specific command to get help for

**Examples:**
```
!tz help
!tz help add
!tz help auth
```

---

#### `ping`
Test bot responsiveness.

**Syntax:** `!tz ping`

**Examples:**
```
!tz ping
```

**Notes:**
- Returns "Pong!" with response time
- Useful for checking if bot is online

---

#### `status`
Display bot status and statistics.

**Syntax:** `!tz status`

**Examples:**
```
!tz status
```

**Information Displayed:**
- Bot uptime
- Memory usage
- Active conversations
- Personality count
- User count
- Error count

### Administrator Commands

#### `debug`
Display debug information (admin only).

**Syntax:** `!tz debug [subcommand]`

**Subcommands:**
- (No subcommands currently available)

**Required Permissions:** Bot Administrator

**Examples:**
```
!tz debug
```

---

#### `purgbot`
Purge bot messages from your DM history.

**Syntax:** `!tz purgbot [system|all]`

**Aliases:** `purgebot`, `clearbot`, `cleandm`

**Required Permissions:** None (DM only)

**Examples:**
```
!tz purgbot          # Purge system messages only
!tz purgbot system   # Purge system messages only
!tz purgbot all      # Purge all bot messages (including personality messages)
```

**Notes:**
- Only works in DM channels
- `system` - Removes system/command messages only
- `all` - Removes all bot messages including personality responses
- User messages are never deleted

---


## Interaction Methods

Beyond commands, users can interact with personalities through:

### 1. Direct Mention
Mention a personality by its alias to start a conversation.

**Example:** `@lilith Hello, how are you?`

### 2. Reply to Personality
Reply to any message from a personality to continue the conversation.

### 3. Auto-Response Mode
When enabled with `!tz autorespond on`, subsequent messages continue the conversation automatically.

### 4. Channel Activation
When a personality is activated in a channel, it responds to all messages from all users.

## Permission Levels

### User Permissions
- **None Required:** Most commands are available to all users
- **Manage Messages:** Required for channel activation/deactivation
- **Administrator:** Required for debug and maintenance commands

### Bot Permissions
The bot requires these Discord permissions to function:
- Read Messages/View Channels
- Send Messages
- Manage Messages (for deleting auth codes)
- Manage Webhooks (for personality messages)
- Attach Files
- Read Message History
- Use External Emojis
- Add Reactions

## Error Handling

Commands include comprehensive error handling:
- Clear error messages for invalid syntax
- Helpful suggestions for common mistakes
- Automatic cleanup of sensitive information (auth codes)
- Graceful handling of API failures

## Rate Limiting

Commands are subject to rate limiting to prevent abuse:
- User-level rate limits
- Channel-level rate limits
- Global rate limits for API calls

See the [SECURITY.md](./SECURITY.md) documentation for more details on rate limiting.