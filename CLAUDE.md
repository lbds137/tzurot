# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tzurot is a Discord bot that uses webhooks to represent multiple AI personalities. It allows users to add personalities and interact with them through Discord channels. The bot is built using Node.js and Discord.js.

## Commands

### Development Commands

- `npm start` - Start the bot in production mode
- `npm run dev` - Start the bot with nodemon for development (auto-restart on file changes)
- `npm run lint` - Run ESLint to check code quality
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run format` - Run Prettier to format code
- `npm run format:check` - Check if code is properly formatted with Prettier
- `npm run quality` - Run both lint and format checks
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode (useful during development)
- Run a specific test: `npx jest tests/unit/path/to/test.js`

## Architecture

### Core Components

1. **Bot (`bot.js`)**: Main entry point for Discord interaction, handling messages, commands, and webhooks.
   - Implements error filtering to prevent error messages from being displayed
   - Manages message deduplication to prevent multiple responses
   - Routes messages to appropriate handlers

2. **Personality Manager (`personalityManager.js`)**: Manages AI personalities.
   - Registers new personalities
   - Handles aliases for personalities
   - Loads/saves personality data to disk

3. **Webhook Manager (`webhookManager.js`)**: Handles Discord webhooks for personality messages.
   - Creates and caches webhooks for each channel
   - Manages message splitting for content exceeding Discord limits
   - Handles error cases and deduplication of messages

4. **AI Service (`aiService.js`)**: Interface with the AI API.
   - Sends requests to the AI service
   - Manages caching and error handling
   - Tracks problematic personalities and implements fallbacks

5. **Conversation Manager (`conversationManager.js`)**: Tracks active conversations.
   - Maps message IDs to personality data
   - Manages continuations of conversations
   - Handles auto-respond functionality

6. **Commands (`commands.js`)**: Processes Discord commands.
   - Parses and validates user commands 
   - Implements functionality for adding, listing, and managing personalities
   - Handles command deduplication and tracking

7. **Profile Info Fetcher (`profileInfoFetcher.js`)**: Fetches profile information for personalities.
   - Retrieves display names and avatars
   - Implements caching to reduce API calls

### Data Flow

1. User sends message to Discord
2. Discord.js client receives message event
3. `bot.js` processes the message:
   - If it's a command (starts with prefix), route to `commands.js`
   - If it's a reply to a personality, look up the personality and continue conversation
   - If it's a mention (@personality), find the personality and start conversation
   - If there's an active conversation or channel-activated personality, continue with that personality
4. For AI response generation:
   - `aiService.js` sends request to AI API with personality name
   - Response is sent via webhook using `webhookManager.js`
   - Conversation data is recorded in `conversationManager.js`

## Important Files

- `index.js` - Application entry point
- `config.js` - Configuration settings and environment variable handling
- `src/bot.js` - Main Discord bot logic
- `src/aiService.js` - AI service integration
- `src/webhookManager.js` - Discord webhook management
- `src/personalityManager.js` - AI personality management
- `src/conversationManager.js` - Conversation tracking and management
- `src/commands.js` - Command processing
- `src/profileInfoFetcher.js` - Fetches profile info (avatars, display names)
- `src/dataStorage.js` - Data persistence utilities
- `src/logger.js` - Logging utilities

## Tests

The project has extensive tests in the `tests` directory, organized as:

- `tests/unit/` - Unit tests for each component
- `tests/mocks/` - Custom mocks for testing
- `tests/__mocks__/` - Jest mocks for npm packages

The tests cover various edge cases, especially around error handling and deduplication.

## Environment Variables

Required environment variables:

- `DISCORD_TOKEN` - Discord bot token
- `SERVICE_API_KEY` - API key for the AI service
- `SERVICE_API_ENDPOINT` - Base URL for the AI service
- `SERVICE_ID` - Service identifier
- `PROFILE_INFO_ENDPOINT` - Endpoint for fetching profile information
- `AVATAR_URL_BASE` - Base URL for avatar images (with {id} placeholder)
- `PREFIX` - Command prefix (defaults to "!tz")

## Key Design Patterns

1. **Error Prevention**:
   - Multiple layers of error handling
   - Message deduplication at several levels
   - Explicit error message filtering

2. **Caching**:
   - Webhook caching to reduce Discord API calls
   - Profile info caching to reduce AI API calls
   - Message tracking to prevent duplicate processing

3. **Modular Architecture**:
   - Clear separation of concerns
   - Component-based design
   - Dependency injection for testing

## Known Issues and Fixes

The codebase has addressed several critical issues:

1. **Duplicate Embed Issue**: Fixed by:
   - Consolidating save operations in the personality registration process
   - Adding multiple deduplication mechanisms
   - Detecting and deleting incomplete embeds

2. **Error Handling**: The system has robust error handling for:
   - API failures
   - Webhook errors
   - Rate limiting
   - Message splitting

## Testing Strategy

When implementing tests, follow these patterns:

1. Use Jest's mocking system to replace external dependencies
2. Implement thorough test coverage for edge cases
3. Use `beforeEach` to reset state between tests
4. Mock console methods to keep test output clean
5. Use the existing mock implementations in `tests/mocks/`