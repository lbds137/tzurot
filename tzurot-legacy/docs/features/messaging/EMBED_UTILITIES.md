# Embed Utilities

This document describes the organization and usage of embed-related utilities in the Tzurot codebase.

## Overview

The codebase has two distinct types of embed-related functionality, organized into separate modules:

1. **Embed Builders** (`/src/utils/embedBuilders.js`) - Creates formatted Discord embeds for UI display
2. **Embed Utils** (`/src/utils/embedUtils.js`) - Processes and extracts information from Discord embeds

## Embed Builders

Located at `/src/utils/embedBuilders.js`, this module contains functions for creating Discord embeds for user interface purposes.

### Key Functions

- `createPersonalityAddedEmbed(profileName, displayName, alias, avatarUrl)` - Creates an embed announcing a personality has been added
- `createPersonalityListEmbed(userId, page)` - Creates a paginated embed listing all personalities for a user
- `createListEmbed(personalities, page, totalPages, author)` - Creates an embed listing personalities on a single page
- `createPersonalityInfoEmbed(personality, aliases)` - Creates an embed with detailed personality information
- `createStatusEmbed(client, totalPersonalities, userPersonalities, verificationStatus)` - Creates an embed with bot status information
- `createHelpEmbed(isAdmin)` - Creates the general help embed with all available commands
- `formatUptime(ms)` - Formats milliseconds as a readable uptime string (e.g., "2d 5h 30m 15s")

### Usage Example

```javascript
const embedBuilders = require('./utils/embedBuilders');

// Create a personality list embed
const { embed, totalPages, currentPage } = embedBuilders.createPersonalityListEmbed(userId, pageNumber);

// Send the embed
message.channel.send({ embeds: [embed] });
```

## Embed Utils

Located at `/src/utils/embedUtils.js`, this module contains utilities for processing Discord embeds, particularly for extracting content and media URLs.

### Key Functions

- `parseEmbedsToText(embeds, source)` - Converts Discord embeds to text representation
- `extractMediaFromEmbeds(embeds, prioritizeAudio)` - Extracts media URLs (images, audio) from embeds
- `detectPersonalityInEmbed(embed)` - Detects if an embed contains a personality message in DM format

### Usage Example

```javascript
const embedUtils = require('./utils/embedUtils');

// Convert embeds to text representation
const embedText = embedUtils.parseEmbedsToText(message.embeds, 'referenced message');

// Extract media URLs from embeds
const { audioUrl, imageUrl, hasAudio, hasImage } = embedUtils.extractMediaFromEmbeds(message.embeds);
```

## Best Practices

1. Use `embedBuilders.js` when creating new embeds for UI display
2. Use `embedUtils.js` when processing existing embeds from messages
3. Keep these responsibilities separate to maintain clean separation of concerns
4. For embed-related tests, ensure you're mocking the correct module