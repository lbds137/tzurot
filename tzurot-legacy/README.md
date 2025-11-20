# Tzurot - Discord AI Personality Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue)](https://discord.js.org)

Tzurot (Hebrew for "shapes") is a sophisticated Discord bot that enables seamless interaction with AI personalities through Discord's webhook system. Each AI personality appears with its own name and avatar, creating authentic character interactions within Discord servers.

## 🌟 Key Features

- **🎭 Multiple AI Personalities**: Add and manage multiple AI personalities, each with unique identities
- **🪝 Webhook Integration**: Personalities use Discord webhooks to appear as distinct users
- **💬 Natural Conversations**: Multiple interaction methods including mentions, replies, and auto-response
- **🔐 User Authentication**: Secure OAuth-like authentication system for API access
- **🎨 Rich Media Support**: Handle images and audio attachments in conversations
- **🛡️ Advanced Moderation**: Channel-wide activation with permission controls
- **📊 Health Monitoring**: Built-in health check endpoint for monitoring
- **🧪 Comprehensive Testing**: 90+ test suites with extensive coverage

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Features](#-features)
- [Documentation](#-documentation)
- [Configuration](#-configuration)
- [Commands](#-commands)
- [Development](#-development)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [Support](#-support)

## 🚀 Quick Start

### Prerequisites

- Node.js 22.x or higher
- npm 10.x or higher
- Discord Bot Token ([create one here](https://discord.com/developers/applications))
- AI Service API credentials

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/lbds137/tzurot.git
   cd tzurot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Start the bot**
   ```bash
   npm run dev  # Development mode with auto-reload
   # or
   npm start    # Production mode
   ```

### First Steps

1. Invite the bot to your Discord server using the OAuth2 URL
2. Run `!tz help` to see available commands
3. Add your first personality: `!tz add personality-name`
4. Start chatting by mentioning the personality: `@personality-name Hello!`

## ✨ Features

### Personality Management
- Add personalities with custom aliases for easy reference
- Each user maintains their own personality collection
- Automatic profile fetching with avatar and display name
- Support for problematic personalities with special handling

### Interaction Methods
1. **Direct Mention**: `@personality Hello!`
2. **Reply to Personality**: Reply to any personality message to continue the conversation
3. **Auto-Response Mode**: Enable continuous conversation without mentions
4. **Channel Activation**: Moderators can activate a personality for an entire channel

### Advanced Features
- **Message Deduplication**: Sophisticated multi-layer system prevents duplicate responses
- **Thread Support**: Full support for Discord threads
- **DM Support**: Private conversations with personalities
- **Media Handling**: Process images and audio files in conversations
- **PluralKit Compatibility**: Works alongside PluralKit and other proxy bots
- **Rate Limiting**: Built-in protection against abuse
- **Enhanced Context** (Preview): Automatic personality data migration for external AI services

### Security & Authentication
- OAuth-like authentication flow for API access
- Secure token management with automatic expiration
- DM-only authorization code submission
- Permission-based command access

## 📚 Documentation

### Core Documentation
- [🏗️ Architecture](docs/core/ARCHITECTURE.md) - System design and component overview
- [🔧 Setup Guide](docs/core/SETUP.md) - Detailed development setup instructions
- [📜 Commands](docs/core/COMMAND_SYSTEM.md) - Complete command system documentation
- [🚀 Deployment](docs/core/DEPLOYMENT.md) - Production deployment guide
- [🔒 Security](docs/core/SECURITY.md) - Security practices and guidelines

### Component Documentation
- [🔐 Authentication](docs/components/AUTHENTICATION.md) - Auth system details
- [🎵 Audio Handling](docs/components/AUDIO_ATTACHMENT.md) - Audio processing
- [🖼️ Image Handling](docs/components/IMAGE_HANDLING.md) - Image processing
- [📝 Message Format](docs/core/MESSAGE_FORMAT_SPECIFICATION.md) - Message specifications

### Development
- [💻 Contributing](docs/core/CONTRIBUTING.md) - How to contribute
- [📏 Coding Standards](docs/core/CODING_STANDARDS.md) - Code style guide
- [🧪 Testing Guide](docs/testing/README.md) - Testing documentation
- [📊 Test Coverage](docs/testing/TEST_COVERAGE_SUMMARY.md) - Current test status

## ⚙️ Configuration

### Required Environment Variables

```env
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token

# AI Service Configuration
SERVICE_API_KEY=your_api_key
SERVICE_API_ENDPOINT=https://api.example.com
SERVICE_ID=your_service_id
SERVICE_WEBSITE=https://app.example.com

# Profile information paths
PROFILE_INFO_PUBLIC_PATH=public/personalities
PROFILE_INFO_PRIVATE_PATH=personalities/username

# Bot Configuration (Optional)
PREFIX=!tz
BOT_OWNER_ID=your_discord_user_id
OWNER_PERSONALITIES=personality1,personality2
LOG_LEVEL=info

# Feature Flags (Optional)
FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT=false  # Enable when migrating to alternate AI services
```

See [SETUP.md](docs/core/SETUP.md) for complete configuration details.

## 🎮 Commands

### Basic Commands
- `!tz help [command]` - Display help information
- `!tz ping` - Check bot responsiveness
- `!tz status` - Show bot statistics

### Personality Management
- `!tz add <name> [alias]` - Add a personality
- `!tz remove <name>` - Remove a personality
- `!tz list [page]` - List your personalities
- `!tz info <name>` - Show personality details
- `!tz alias <name> <alias>` - Add an alias

### Conversation Control
- `!tz autorespond <on/off>` - Toggle auto-response
- `!tz reset` - Clear active conversation
- `!tz activate <name>` - Activate for channel (mod only)
- `!tz deactivate` - Deactivate channel personality

### Authentication
- `!tz auth start` - Begin authentication
- `!tz auth status` - Check auth status
- `!tz verify` - Verify authentication

See [COMMAND_SYSTEM.md](docs/core/COMMAND_SYSTEM.md) for the complete command system documentation.

## 🛠️ Development

### Available Scripts

```bash
npm start          # Start in production mode
npm run dev        # Start with auto-reload
npm test           # Run all tests
npm run lint       # Check code style
npm run format     # Format code
npm run quality    # Run lint and format
```

### Project Structure

Tzurot follows a **Domain-Driven Design (DDD)** architecture with clear separation of concerns:

```
tzurot/
├── src/                    # Source code
│   ├── domain/             # Domain layer - business logic and entities
│   │   ├── ai/             # AI domain (requests, content, models)
│   │   ├── authentication/ # Authentication domain (tokens, auth context)
│   │   ├── conversation/   # Conversation domain (messages, channels)
│   │   ├── personality/    # Personality domain (profiles, aliases)
│   │   ├── backup/         # Backup domain (jobs, data export)
│   │   └── shared/         # Shared domain concepts (events, aggregates)
│   ├── application/        # Application layer - use cases and coordination
│   │   ├── bootstrap/      # Application initialization and wiring
│   │   ├── commands/       # Command handlers organized by domain
│   │   │   ├── authentication/  # Auth commands (auth, verify, blacklist)
│   │   │   ├── conversation/    # Conversation commands (activate, reset)
│   │   │   ├── personality/     # Personality commands (add, list, config)
│   │   │   └── utility/         # Utility commands (help, ping, debug)
│   │   ├── services/       # Application services and coordination
│   │   ├── routers/        # Request routing and dispatching
│   │   └── eventHandlers/  # Domain event handling
│   ├── adapters/           # Adapters layer - external integrations
│   │   ├── ai/             # AI service adapters (HTTP, factory)
│   │   ├── discord/        # Discord API adapters (messages, webhooks)
│   │   └── persistence/    # Data persistence adapters (file-based)
│   ├── infrastructure/     # Infrastructure layer - technical concerns
│   │   ├── authentication/ # OAuth and token management
│   │   └── backup/         # Backup and archival infrastructure
│   ├── core/              # Core business logic (legacy, being migrated)
│   │   ├── api/           # Profile and API client logic
│   │   ├── conversation/  # Conversation management
│   │   └── notifications/ # Release and update notifications
│   ├── handlers/          # Legacy message handlers (being phased out)
│   ├── utils/             # Utility functions and helpers
│   └── ...
├── tests/                 # Test files (mirrors src structure)
├── docs/                  # Comprehensive documentation
├── scripts/               # Development and deployment scripts
└── data/                  # Runtime data storage
```

#### Architecture Principles

- **Domain-Driven Design**: Business logic isolated in domain layer
- **Clean Architecture**: Dependencies flow inward toward domain
- **Command Pattern**: All user actions handled via command objects
- **Event-Driven**: Domain events for loose coupling between contexts
- **Dependency Injection**: Testable, mockable external dependencies
- **Legacy Migration**: Gradual migration from flat structure to DDD

#### Migration Notes

⚠️ **Hybrid Architecture**: The project is currently in a migration phase from a legacy flat structure to DDD. Both systems coexist:

- **New Commands**: Use DDD structure in `src/application/commands/` organized by domain
- **Legacy Systems**: Core message processing, AI handling, and webhook management still use legacy architecture
- **Feature Parity**: All functionality is preserved during migration - no features are lost
- **Gradual Migration**: Components are migrated incrementally to minimize risk and maintain stability

## 🧪 Testing

The project includes comprehensive test coverage with 800+ tests across 90+ test suites.

```bash
# Run all tests
npm test

# Run specific test
npx jest tests/unit/bot.test.js

# Run with coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

See [Testing Documentation](docs/testing/README.md) for more details.

## 📦 Deployment

Tzurot can be deployed in multiple ways:

- **VPS**: Traditional server deployment with PM2
- **Docker**: Containerized deployment
- **PaaS**: Railway, Heroku, Render
- **Systemd**: Linux service deployment

**⚠️ Current Limitations:**
- Data is stored in JSON files (not persistent across redeploys)
- Auth tokens are stored in memory (users must re-authenticate after restarts)
- For production use, database integration is recommended

See [DEPLOYMENT.md](docs/core/DEPLOYMENT.md) for detailed instructions.

## 🤝 Contributing

Contributions are welcome! Please see the [Contributing Guide](docs/core/CONTRIBUTING.md) for details on:

- Development setup
- Submitting pull requests
- Coding standards
- Testing requirements

### Development Workflow

This project uses a feature branch workflow with protected branches:
- All changes must be made via pull requests
- CI checks (tests and linting) must pass
- Feature branches are created from `develop`, not `main`
- See our [Git Workflow Guide](docs/development/GIT_AND_PR_WORKFLOW.md) for detailed instructions

## 🐛 Troubleshooting

Common issues and solutions:

- **Bot not responding**: Check token and permissions
- **Personalities not loading**: Verify API credentials
- **Webhook errors**: Ensure bot has "Manage Webhooks" permission

For more help, see our [Troubleshooting Guide](docs/core/TROUBLESHOOTING.md) or open an issue.

## 📊 Health Monitoring

Tzurot includes a built-in health check endpoint for monitoring:

```
GET http://your-server:3000/health
```

Returns system status, memory usage, uptime, and component health.

## 🌐 Support

- 📖 [Documentation](docs/)
- 🐛 [Issue Tracker](https://github.com/lbds137/tzurot/issues)
- 💬 [Discussions](https://github.com/lbds137/tzurot/discussions)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Discord.js](https://discord.js.org)
- Inspired by PluralKit's proxy system
- Thanks to all contributors and testers

---

<p align="center">Made with ❤️ as a personal project</p>