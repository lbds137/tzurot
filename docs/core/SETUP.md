# Development Setup Guide

This guide provides detailed instructions for setting up Tzurot for local development.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Discord Bot Setup](#discord-bot-setup)
- [AI Service Configuration](#ai-service-configuration)
- [Running the Bot](#running-the-bot)
- [Development Tools](#development-tools)
- [Testing Setup](#testing-setup)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Node.js 22.x or higher** - JavaScript runtime
- **npm 10.x or higher** - Package manager (comes with Node.js)
- **Git** - Version control
- **Text Editor/IDE** - VS Code, WebStorm, or similar

### Required Accounts

- **Discord Developer Account** - For creating bot application
- **AI Service Account** - For API access to your chosen AI service

### Recommended Tools

- **nodemon** - Auto-restart on file changes (installed as dev dependency)
- **ESLint extension** - For your IDE
- **Prettier extension** - For code formatting

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/lbds137/tzurot.git
cd tzurot
```

### 2. Install Dependencies

```bash
npm install
```

This installs all required packages including:
- discord.js - Discord API wrapper
- node-fetch - HTTP client
- dotenv - Environment variable management
- winston - Logging framework
- Development tools (Jest, ESLint, Prettier)

### 3. Create Environment File

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration values.

## Environment Configuration

### Complete Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# ===== REQUIRED CONFIGURATION =====

# Discord Bot Token
# Get this from https://discord.com/developers/applications
DISCORD_TOKEN=your_discord_bot_token_here

# AI Service API Configuration
# Your AI service API key
SERVICE_API_KEY=your_api_key_here

# Base URL for the AI service API (without /v1)
SERVICE_API_BASE_URL=https://api.example.com

# Service identifier for model paths
SERVICE_ID=your_service_id

# Service Website URL
SERVICE_WEBSITE=https://app.example.com

# Profile Information Paths
# Public profile path (no auth required)
PROFILE_INFO_PUBLIC_PATH=public/personalities
# Private profile path (requires auth)
PROFILE_INFO_PRIVATE_PATH=personalities/username

# ===== OPTIONAL CONFIGURATION =====

# Bot Command Prefix (default: !tz)
PREFIX=!tz

# Bot Owner Discord User ID
# Used for admin commands and special permissions
BOT_OWNER_ID=your_discord_user_id_here

# Owner's Default Personalities
# Comma-separated list of personalities auto-added for bot owner
OWNER_PERSONALITIES=albert-einstein,sigmund-freud,carl-jung,marie-curie

# Known Problematic Personalities
# Personalities that require special error handling
KNOWN_PROBLEMATIC_PERSONALITIES=lucifer-kochav-shenafal,lilith-tzel-shani

# Logging Level (debug, info, warn, error)
LOG_LEVEL=info

# ===== ADVANCED CONFIGURATION =====

# API Timeout (milliseconds, default: 30000)
API_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW=60000

# Cache TTL (milliseconds, default: 86400000 = 24 hours)
PROFILE_CACHE_TTL=86400000

# Message Tracking Limit (default: 1000)
MESSAGE_TRACK_LIMIT=1000

# Conversation Timeout (milliseconds, default: 1800000 = 30 minutes)
CONVERSATION_TIMEOUT=1800000
```

### Environment Variable Details

#### Required Variables

1. **DISCORD_TOKEN**
   - Your Discord bot's authentication token
   - Never commit this to version control
   - Keep it secret and rotate if compromised

2. **SERVICE_API_KEY**
   - Authentication key for the AI service
   - Required for making API calls
   - Service-specific format

3. **SERVICE_API_BASE_URL**
   - Base URL for AI service API
   - Should NOT include version path (/v1)
   - Example: `https://api.example.com`

4. **SERVICE_ID**
   - Identifier used in model paths
   - Usually provided by AI service
   - Example: `your_service_id`

5. **SERVICE_WEBSITE**
   - Base URL of the service website
   - Used for constructing API endpoints
   - Example: `https://app.example.com`

6. **PROFILE_INFO_PUBLIC_PATH**
   - API path for public personality profiles (no auth required)
   - Combined with SERVICE_WEBSITE to form full URL
   - Example: `public/personalities`
   - Full URL would be: `{SERVICE_WEBSITE}/api/{PROFILE_INFO_PUBLIC_PATH}/{personalityName}`

7. **PROFILE_INFO_PRIVATE_PATH**
   - API path for private personality profiles (requires authentication)
   - Used by backup command and authenticated requests
   - Example: `personalities/username`
   - Full URL would be: `{SERVICE_WEBSITE}/api/{PROFILE_INFO_PRIVATE_PATH}/{personalityName}`

#### Optional Variables

1. **PREFIX**
   - Command prefix for bot commands
   - Default: `!tz`
   - Can be changed to avoid conflicts

2. **BOT_OWNER_ID**
   - Discord user ID of bot owner
   - Enables admin commands
   - Find via Discord Developer Mode

3. **OWNER_PERSONALITIES**
   - Comma-separated personality list
   - Auto-added for bot owner on startup
   - Useful for testing

4. **LOG_LEVEL**
   - Controls logging verbosity
   - Options: `debug`, `info`, `warn`, `error`
   - Use `debug` for development

## Discord Bot Setup

### 1. Create Discord Application

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Enter application name (e.g., "Tzurot Dev")
4. Navigate to "Bot" section

### 2. Configure Bot Settings

1. Click "Add Bot"
2. Configure bot settings:
   - **Username**: Your bot's display name
   - **Icon**: Upload bot avatar (optional)
   - **Public Bot**: Uncheck for private testing
   - **Requires OAuth2 Code Grant**: Leave unchecked

3. Enable Intents:
   - **Message Content Intent**: Required
   - **Server Members Intent**: Recommended
   - **Presence Intent**: Optional

### 3. Copy Bot Token

1. Under "Token" section, click "Copy"
2. Add to your `.env` file as `DISCORD_TOKEN`
3. Never share this token publicly

### 4. Generate Invite Link

1. Navigate to "OAuth2" → "URL Generator"
2. Select scopes:
   - `bot`
   - `applications.commands` (if using slash commands)

3. Select bot permissions:
   ```
   Required:
   ✓ View Channels
   ✓ Send Messages
   ✓ Manage Messages
   ✓ Manage Webhooks
   ✓ Read Message History
   ✓ Add Reactions
   ✓ Attach Files
   ✓ Use External Emojis
   
   Recommended:
   ✓ Embed Links
   ✓ Mention Everyone (for error messages)
   ```

4. Copy generated URL and invite bot to test server

### 5. Get Your User ID

1. Enable Discord Developer Mode:
   - User Settings → Advanced → Developer Mode
2. Right-click your username → "Copy ID"
3. Add to `.env` as `BOT_OWNER_ID`

## AI Service Configuration

### AI Service Setup

1. **Get API Key**:
   - Visit your AI service's developer portal
   - Generate API key
   - Add to `.env` as `SERVICE_API_KEY`

2. **Verify Endpoints**:
   - Test API endpoint with curl/Postman
   - Verify profile endpoint returns data
   - Check avatar URLs are accessible

3. **Test Personalities**:
   - Add known working personalities to `OWNER_PERSONALITIES`
   - Test with simple personalities first

### Custom AI Service Setup

If using a different AI service:

1. Update endpoint URLs in `.env`
2. Ensure API is OpenAI-compatible or modify `aiService.js`
3. Verify response format matches expectations
4. Test avatar and profile endpoints

## Running the Bot

### Development Mode

Start with auto-reload on file changes:

```bash
npm run dev
```

Features:
- Automatic restart on code changes
- Verbose logging
- Source map support

### Production Mode

Start without development features:

```bash
npm start
```

### First Run Checklist

1. ✓ Bot comes online (check Discord status)
2. ✓ No errors in console
3. ✓ Bot responds to `!tz ping`
4. ✓ Can add personalities with `!tz add`
5. ✓ Personalities respond to mentions

## Development Tools

### Available Scripts

```bash
# Start bot in production mode
npm start

# Start bot with nodemon (auto-restart)
npm run dev

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Check code style
npm run lint

# Fix code style issues
npm run lint:fix

# Format code with Prettier
npm run format

# Run both lint and format
npm run quality
```

### IDE Setup

#### VS Code

1. Install extensions:
   - ESLint
   - Prettier
   - GitLens
   - Discord.js Snippets

2. Add workspace settings:
   ```json
   {
     "editor.formatOnSave": true,
     "editor.codeActionsOnSave": {
       "source.fixAll.eslint": true
     },
     "eslint.validate": ["javascript"],
     "prettier.singleQuote": true,
     "prettier.tabWidth": 2
   }
   ```

#### WebStorm

1. Enable ESLint:
   - Settings → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint
   - Select "Automatic ESLint configuration"

2. Configure Prettier:
   - Settings → Languages & Frameworks → JavaScript → Prettier
   - Enable "Run on save"

### Debugging

#### VS Code Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Bot",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/index.js",
      "envFile": "${workspaceFolder}/.env",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand"],
      "console": "integratedTerminal"
    }
  ]
}
```

## Testing Setup

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx jest tests/unit/bot.test.js

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage

# Run tests matching pattern
npm test -- --testNamePattern="personality"
```

### Test Environment

Tests use mocked Discord.js and API calls. See `tests/setup.js` for configuration.

### Writing Tests

1. Place unit tests in `tests/unit/`
2. Follow existing test patterns
3. Use provided mock utilities
4. Keep tests focused and isolated

## Troubleshooting

### Common Issues

#### Bot Not Coming Online

1. **Check Token**: Ensure `DISCORD_TOKEN` is correct
2. **Check Intents**: Message Content Intent must be enabled
3. **Check Logs**: Look for connection errors
4. **Network**: Ensure firewall allows Discord connections

#### Commands Not Working

1. **Check Prefix**: Ensure using correct prefix (`!tz`)
2. **Check Permissions**: Bot needs message permissions
3. **Check Logs**: Look for command processing errors

#### Personalities Not Responding

1. **Check API Key**: Ensure `SERVICE_API_KEY` is valid
2. **Test Endpoints**: Verify API endpoints are accessible
3. **Check Personality Name**: Must match exactly
4. **Check Logs**: Look for API errors

#### Webhook Errors

1. **Check Permissions**: Bot needs "Manage Webhooks"
2. **Channel Limits**: Discord limits webhooks per channel
3. **Clean Webhooks**: Remove old webhooks if needed

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

This shows:
- All API requests/responses
- Detailed error messages
- Message processing flow
- Cache operations

### Getting Help

1. Check existing documentation
2. Review error messages and logs
3. Search issues on GitHub
4. Ask in Discord development server
5. Create detailed bug report with:
   - Error messages
   - Steps to reproduce
   - Environment details
   - Relevant logs

## Next Steps

After successful setup:

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the codebase
2. Review [COMMAND_SYSTEM.md](./COMMAND_SYSTEM.md) for all available commands
3. Check [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines
4. Explore the test suite to understand functionality
5. Start with small changes and test thoroughly

Happy coding! 🚀