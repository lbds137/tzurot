# Tzurot - Discord AI Personality Bot

## Project Overview

Tzurot (Hebrew for "shapes") is a Discord bot that provides seamless interaction with AI personalities from Shapes.inc through Discord webhooks. The bot acts as a bridge between Discord users and the Shapes.inc API, enabling natural conversation with AI characters while maintaining visual identity through profile pictures and display names.

## Background & Context

### Shapes.inc Platform Integration
- **Current Status**: Direct Shapes.inc Discord integration was discontinued
- **API Access**: Bot uses the Shapes.inc API for AI interactions
- **Data Safety**: All conversations and personality data remain on Shapes.inc platform
- **Profile Integration**: Bot dynamically fetches personality avatars and display names

### Technical Approach
The bot uses a PluralKit-inspired webhook system to create authentic AI character interactions:
- **Message Proxying**: Uses Discord webhooks to display messages with character names and avatars
- **Multiple Trigger Methods**: Supports @mentions, replies, and optional auto-response modes
- **Permission-Based Features**: Different activation levels based on Discord permissions

## Architecture & Implementation

### Core Components

#### 1. Discord Bot Core (`src/bot.js`)
- **Message Processing**: Handles incoming Discord messages
- **Event Management**: Manages Discord client events and webhook events
- **Permission Checking**: Validates user permissions for restricted commands
- **Error Handling**: Graceful error handling with user-friendly messages

#### 2. Webhook Management (`src/webhookManager.js`)
- **Webhook Creation**: Creates webhooks per channel as needed
- **Message Proxying**: Sends messages with personality names and avatars
- **Cache Management**: Caches webhook clients to reduce API calls
- **Event Listeners**: Handles webhook cleanup when channels are deleted

#### 3. AI Service Integration (`src/aiService.js`)
- **Shapes.inc API**: OpenAI-compatible API client for Shapes.inc
- **Context Headers**: Includes `X-User-Id` and `X-Channel-Id` for conversation context
- **Error Handling**: Fallback responses when API is unavailable
- **Request Management**: Handles API rate limits and timeouts

#### 4. Personality Management (`src/personalityManager.js`)
- **Registration System**: Add/remove AI personalities
- **Alias Management**: User-friendly nicknames for personalities
- **Profile Fetching**: Automatic avatar and display name retrieval
- **Data Persistence**: File-based storage for personality data
- **User Ownership**: Track which user added each personality

#### 5. Profile Info Fetcher (`src/profileInfoFetcher.js`)
- **Dynamic Avatars**: Fetches profile pictures from Shapes.inc
- **Display Names**: Retrieves proper character names
- **Caching System**: 24-hour cache to reduce API calls
- **Error Resilience**: Graceful handling when profile info unavailable

#### 6. Conversation Management (`src/conversationManager.js`)
- **Active Conversations**: Track ongoing user-personality interactions
- **Auto-Response Control**: User-configurable conversation continuation
- **Channel Activation**: Moderator-controlled channel-wide personality activation
- **Context Tracking**: Maintain conversation state across messages
- **Timeout Management**: Automatic cleanup of stale conversations

#### 7. Command System (`src/commands.js`)
- **Comprehensive Help**: Detailed command documentation
- **Permission Checks**: Role-based command restrictions
- **User Management**: Personal personality collection management
- **Administrative Tools**: Channel-wide activation controls

#### 8. Configuration Management (`config.js`)
- **Environment Variables**: Secure configuration via .env files
- **URL Management**: Centralized API endpoint configuration
- **Security**: No hardcoded sensitive information

#### 9. Data Storage (`src/dataStorage.js`)
- **File-Based Persistence**: JSON storage for personalities and aliases
- **Automatic Initialization**: Creates storage directory structure
- **Error Handling**: Graceful handling of storage operations

### Project Structure
```
tzurot/
├── .env                      # Environment configuration
├── package.json              # Node.js dependencies
├── index.js                  # Application entry point
├── config.js                 # Configuration management
├── data/                     # Persistent data storage
│   ├── personalities.json   # Personality definitions
│   └── aliases.json          # Alias mappings
├── src/
│   ├── bot.js               # Discord bot core
│   ├── commands.js          # Command handlers
│   ├── aiService.js         # Shapes.inc API integration
│   ├── webhookManager.js    # Discord webhook management
│   ├── personalityManager.js # Personality CRUD operations
│   ├── profileInfoFetcher.js # Dynamic profile information
│   ├── conversationManager.js # Conversation state tracking
│   └── dataStorage.js       # File-based persistence
└── logs/                    # Application logs (optional)
```

## Features & Functionality

### User Commands

#### Basic Commands
- `!tz help` - Display help information
- `!tz help <command>` - Get detailed help for specific command
- `!tz ping` - Test bot responsiveness
- `!tz status` - Display bot status and statistics

#### Personality Management
- `!tz add <personality_name> [alias]` - Add a new AI personality
- `!tz list` - List your added personalities
- `!tz info <personality>` - Show detailed personality information
- `!tz alias <personality> <new_alias>` - Add alias to personality
- `!tz remove <personality>` - Remove personality from your collection

#### Conversation Control
- `!tz autorespond <on|off|status>` - Toggle personal auto-response
- `!tz reset` - Clear active conversation
- `!tz activate <personality>` - Channel-wide activation (requires Manage Messages)
- `!tz deactivate` - Disable channel-wide activation (requires Manage Messages)

### Interaction Methods

#### 1. Direct Mention
```
@personalityalias Hello, how are you today?
```
- Triggers immediate response from specified personality
- Case-insensitive alias matching
- Works for any user

#### 2. Reply-Based Conversation
- Reply to any webhook message to continue conversation with that personality
- Maintains conversation context automatically
- Works for any user

#### 3. Auto-Response Mode (User-Specific)
- After mentioning/replying to a personality, subsequent messages continue the conversation
- Must be explicitly enabled with `!tz autorespond on`
- Only affects the user who enabled it
- Times out after 30 minutes of inactivity
- Disabled by default

#### 4. Channel Activation (Moderator-Only)
- Channel-wide personality activation using `!tz activate <personality>`
- Requires "Manage Messages" permission
- Personality responds to ALL messages from ALL users in the channel
- Remains active until explicitly deactivated
- Useful for dedicated AI character channels

### Security & Permissions

#### Configuration Security
- **Environment Variables**: All sensitive data stored in .env files
- **No Hardcoded Secrets**: API keys and URLs configurable via environment
- **Repository Safety**: .env files excluded from version control

#### Permission System
- **User Commands**: Basic personality management available to all users
- **Auto-Response**: Personal setting, no special permissions required
- **Channel Activation**: Requires Discord "Manage Messages" permission
- **Data Isolation**: Users can only manage their own personalities

### Technical Features

#### Dynamic Profile Integration
- **Automatic Avatars**: Fetches character profile pictures from Shapes.inc
- **Display Names**: Uses proper character names from API
- **Caching**: 24-hour cache for profile information
- **Fallback Handling**: Graceful degradation when profile unavailable

#### Conversation Context
- **User Identification**: `X-User-Id` header for personalized responses
- **Channel Context**: `X-Channel-Id` header for location-aware conversations
- **Memory Persistence**: Leverages Shapes.inc's built-in conversation memory
- **Context Switching**: Separate conversations per personality per user

#### Performance Optimizations
- **Webhook Caching**: Reuses webhooks to minimize Discord API calls
- **Profile Caching**: Reduces external API requests
- **Memory Management**: Automatic cleanup of stale conversation data
- **Error Recovery**: Robust error handling with user feedback

## Environment Configuration

### Required Environment Variables
```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
PREFIX=!tz

# Shapes.inc API Configuration
SERVICE_API_KEY=your_shapes_api_key_here
SERVICE_API_ENDPOINT=https://api.shapes.inc/v1
SERVICE_ID=shapesinc
PROFILE_INFO_ENDPOINT=https://shapes.inc/api/shapes/username
AVATAR_URL_BASE=https://files.shapes.inc/avatar_
```

### Discord Bot Setup
1. Create application at Discord Developer Portal
2. Enable bot with required permissions:
   - Read Messages/View Channels
   - Send Messages
   - Manage Messages
   - Manage Webhooks
   - Attach Files
   - Read Message History
   - Use External Emojis
   - Add Reactions
3. Copy bot token to environment variables

### Shapes.inc API Setup
1. Obtain API key from Shapes.inc developer portal
2. Configure environment variables with API credentials
3. Test API connectivity

## Deployment Options

### Local Development
```bash
npm install
# Configure .env file
node index.js
```

### VPS Deployment (Recommended)
- **Platform**: Digital Ocean, AWS, Linode ($5-10/month)
- **Process Manager**: PM2 for 24/7 uptime
- **System Requirements**: Node.js 16+, minimal RAM/CPU requirements
- **Monitoring**: Built-in logging, optional external monitoring

### Platform-as-a-Service
- **Railway.app**: Easy deployment with GitHub integration
- **Heroku**: Traditional PaaS option (paid tiers)
- **Render**: Modern alternative to Heroku

## Advanced Features & Extensibility

### Data Persistence
- **File-Based Storage**: JSON files for development/small deployments
- **Database Migration Path**: Designed for easy database integration
- **Backup Strategy**: Simple file-based backups

### Monitoring & Logging
- **Winston Integration**: Structured logging to files and console
- **Error Tracking**: Detailed error logging with context
- **Performance Metrics**: Built-in status command with bot statistics

### Scalability Considerations
- **Horizontal Scaling**: Stateless design for multi-instance deployment
- **Database Ready**: Architecture supports database integration
- **Rate Limiting**: Built-in protection against API abuse

## Development Guidelines

### Code Organization
- **Modular Design**: Separated concerns with clear module boundaries
- **Error Handling**: Comprehensive error handling throughout
- **Documentation**: JSDoc comments for public functions
- **Testing**: Structure supports unit and integration testing

### Contributing Guidelines
- **Environment Setup**: Clear development environment setup
- **Code Style**: Consistent formatting and naming conventions
- **Security**: Never commit sensitive configuration
- **Testing**: Test new features thoroughly before deployment

## Future Enhancements

### Planned Features
- **Rich Embeds**: Enhanced message formatting
- **Image Support**: Profile picture customization
- **Multi-Server Sync**: Cross-server personality synchronization
- **Analytics Dashboard**: Usage statistics and metrics
- **Advanced Permissions**: Role-based feature access

### Integration Opportunities
- **Database Migration**: PostgreSQL/MongoDB for larger deployments
- **Web Dashboard**: Browser-based configuration interface
- **API Extensions**: Additional Shapes.inc feature integration
- **Mobile Notifications**: Push notifications for important messages

## Troubleshooting

### Common Issues
- **Permission Errors**: Verify Discord bot permissions
- **API Timeouts**: Check Shapes.inc API connectivity
- **Webhook Failures**: Ensure channel permissions for webhook creation
- **Memory Usage**: Monitor for conversation data buildup

### Debug Features
- **Verbose Logging**: Environment variable to enable debug mode
- **Status Command**: Built-in system health checking
- **Error Messages**: User-friendly error reporting

## Success Metrics

### Technical Metrics
- **Uptime**: 99%+ availability target
- **Response Time**: <2 second average response time
- **Error Rate**: <1% failed requests
- **Memory Usage**: Stable memory consumption

### User Experience Metrics
- **User Adoption**: Number of active users
- **Personality Usage**: Popular personalities and interaction patterns
- **User Retention**: Daily/weekly active users
- **Feature Usage**: Command and interaction method popularity

---

*This documentation represents the complete implementation of Tzurot, incorporating both high-level architecture decisions and detailed implementation specifics. The bot provides a robust, scalable foundation for Discord-based AI personality interaction.*