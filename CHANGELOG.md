# Changelog

All notable changes to the Tzurot Discord bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0-alpha.9] - 2025-10-26

### Added
- **Personality Import Tool** - Import personalities and memories from shapes.inc backups
  - Imported Ha-shem, Emily, and Lucifer personalities with full memory history
  - Fixed schema compatibility issues (removed avatarUrl field)
  - Hybrid UUID mapping: known users → v3 personas, unknown → legacy collections
  - Imported 1,710 total memories (1,396 to user persona, 104 legacy collections)
- **Avatar Migration** - Added Ha-shem, Emily, and Lucifer avatars to Railway volume
  - Avatars bundled with deployment and copied to persistent /data volume
  - Served via api-gateway at /avatars endpoint

### Fixed
- **Import Script Schema Mismatch** - PersonalityMapper was using avatarUrl field that doesn't exist in v3 schema
  - v3 uses Discord webhooks for avatars, not database-stored URLs
  - Avatar URLs preserved in customFields for reference
- **Avatar Storage Paths** - Disabled local avatar download (v3 uses Discord webhooks)
  - Preserved shapes.inc avatar URLs in personality customFields

## [2.2.10] - 2025-08-13

### Fixed
- **Critical Reply Bug** - Fixed crash when replying to personality messages
  - `getPersonalityApplicationService()` was returning undefined due to incorrect property path
  - This affected reply processing, DM handling, alias resolution, and error handling
  - One-line fix resolved multiple breaking issues across the bot

### Added
- **Testing Infrastructure** - Comprehensive test utilities for safer development
  - Discord.js mock factories for creating test objects
  - Message factory with fluent builder pattern
  - 28 golden master test scenarios for message formatting
  - Test helpers and migration utilities

### Changed
- **Documentation Organization** - Improved documentation structure and discoverability
  - Reorganized docs into appropriate subdirectories
  - Added CURRENT_WORK.md for tracking active development
  - Created comprehensive documentation index
  - Updated CLAUDE.md to reference current work tracking
  - Improved navigation with quick links and active work sections

## [2.2.9] - 2025-08-12

### Fixed
- **Multi-word Tag Parsing** - Fixed bug where multi-word personality aliases like `@cash money` weren't being recognized
  - Max alias word count was being calculated before personalities were loaded from disk
  - Now properly recalculates after loading personalities to support multi-word aliases
  - Set minimum default of 2 words to ensure multi-word aliases always work
- **Authentication Error Messages** - Improved clarity of authentication-related error messages
  - Better error reporting when authentication fails or is required
- **Hardcoded Bot Prefixes** - Replaced hardcoded `!tz` prefixes with dynamic configuration
  - Bot prefix is now properly read from configuration throughout the codebase
  - Improves flexibility for different bot instances

### Changed
- **Internal Refactoring** - Removed unnecessary PersonalityRouter abstraction layer
  - Simplified architecture by using PersonalityApplicationService directly
  - Improved code clarity with consistent service terminology
  - No user-facing changes

### Documentation
- Created comprehensive bug tracking document in `docs/development/KNOWN_BUGS.md`
- Consolidated feature ideas in `docs/improvements/post-ddd/FEATURE_IDEAS.md`
- Updated DDD migration documentation to reflect current reality

## [2.2.8] - 2025-07-25

### Fixed
- **Feature Flag System** - Removed leftover DDD migration artifacts and cleaned up feature flag warnings
  - Removed "🆕 Using new DDD system" indicators from command responses (info, list, reset commands)
  - Fixed console warnings about unknown `features.enhanced-context` feature flag
  - Streamlined feature flag system to only actively used flags
  - Updated tests to match cleaned up feature flag functionality

## [2.2.7] - 2025-07-26

### Fixed
- Code quality improvements and linter cleanup
- Removed deprecated domain object methods that were no longer used
- Fixed timer pattern compliance for better test performance
- Removed unused variables and cleaned up imports
- Improved test coverage for message formatting (87.64% coverage)

### Removed
- Removed contentSanitizer utility that was solving a non-existent problem
- Removed legacy dataStorage.js module and related unused code
- Removed DDD system feature flags that were no longer needed

## [2.2.6] - 2025-07-25

### Fixed
- **Message Deletion Bug** - Removed unwanted error filtering functionality that was automatically deleting AI personality responses
  - AI responses containing common phrases like "trouble", "issue", or "feeling okay" were being incorrectly flagged as errors
  - Removed aggressive error filtering system including errorHandler.js and related components
  - Webhook messages are no longer monitored or deleted based on content patterns
  - Fixes "flickering" messages that appeared briefly then disappeared

## [2.2.5] - 2025-07-22

### Fixed
- **API Error Handling in Threads** - Fixed post-deployment bug where AI service API errors in threads were falling back to direct send format
  - API errors (502, 429, etc.) now properly display personality-specific error messages via webhooks
  - Maintains immersive experience across all contexts (channels, threads, DMs)
  - Only 404 errors (personality not found) continue to show as bot messages
  - Ensures consistent error handling across the entire Discord interface

## [2.2.4] - 2025-07-21

### Fixed
- **Discord 2000 Character Limit Overflow** - Fixed critical bug where model indicators could push messages over Discord's limit
  - Model indicators (e.g., "(Model: gpt-4)") are now added BEFORE message splitting
  - Prevents messages near 2000 characters from failing to send
  - Affects all message types: regular webhooks, threads, and DMs

### Changed
- **Message Splitting Refactored** - Centralized message splitting logic for better maintainability
  - Created new `messageSplitting.js` utility module
  - Removed 200+ lines of duplicate code across webhook handlers
  - Ensures consistent splitting behavior across all message types

### Improved
- **Error Handling** - Fixed confusing behavior where errors appeared as personality messages
  - Raw error messages no longer sent via webhook
  - Improved error logging in personality handler
  - Error IDs now use crypto.randomUUID() for guaranteed uniqueness

## [2.2.3] - 2025-01-18

### Fixed
- **Personality Error Messages** - Fixed personality-specific error messages not displaying
  - PersonalityRouter was returning raw Personality aggregate objects
  - Added `toJSON()` serialization to access error message property
  - Personalities now correctly show their custom error messages (e.g., "*sighs dramatically* Something went wrong!")
  - Includes enhanced debug logging for troubleshooting

## [2.2.2] - 2025-01-18

### Changed
- **Model Indicator Terminology** - Updated model indicator text for consistency
  - Changed "Main Model Used (Premium)" to "Primary Model Used (Premium)"
  - Changed "Main Model Used (Free)" to "Primary Model Used (Free)"
  - Provides clearer and more consistent terminology across the bot

## [2.2.1] - 2025-01-18

### Fixed
- **PluralKit Authentication Issue** - Fixed authentication errors for PluralKit webhook messages
  - Resolved error: "User [webhook_id] is not authenticated" for PluralKit users
  - Fixed `handlePersonalityInteraction` to use real user ID instead of webhook user ID for authentication
  - Fixed `handleActiveConversation` to properly detect active conversations for PluralKit users
  - PluralKit users can now properly authenticate and maintain conversation continuity
  - Enhanced debug logging to show both webhook ID and real user ID for troubleshooting

## [2.2.0] - 2025-01-18

### Added
- **Fallback Engine Indicators** - Messages now display model usage information
  - "Primary Model Used (Premium)" when using premium model with `is_premium: true`
  - "Primary Model Used (Free)" when using standard model with `is_premium: false`
  - "Fallback Model Used" when using fallback engine with `fallback_model_used: true`
  - Indicators appear as small Discord text (using `-#` formatting) at the end of personality messages
  - Works across all message types: DMs, regular channels, and threads

### Changed
- **Extended Personality Reference Optimization** - Same-personality reference time window extended from 1 hour to 24 hours
  - Personalities can now reference their own recent messages from up to 24 hours ago
  - Improves conversation continuity for longer interactions
  - Reduces redundant context building for active personalities

### Fixed
- **Blacklist Migration Cleanup** - Removed unnecessary migration code and tests
  - Cleaned up deprecated `migrateBlacklistData` function and related tests
  - Simplified FileBlacklistRepository initialization
  - Reduced technical debt in authentication domain

## [2.1.1] - 2025-07-10

### Fixed
- **Webhook URL Corruption in Thread Messages** - Fixed critical production issue causing thread message failures
  - Root cause: Inconsistent webhook client construction between threadHandler and webhookCache
  - threadHandler was using `new WebhookClient({ url: webhook.url })` while webhookCache used `{ id, token }`
  - This inconsistency corrupted webhook URLs for specific threads (e.g., thread ID 1377848847119679508)
  - Now threadHandler uses webhookCache.getOrCreateWebhook() for consistent webhook construction
  - Fixes "The provided webhook URL is not valid" errors in production
  - Emergency fallback now works properly for both short and long messages
  - Tested successfully on regular threads and forum threads

## [2.1.0] - 2025-07-10

### Added
- **Context Metadata for Personalities** - AI personalities now receive temporal and location context
  - Messages include Discord server name, channel name, and timestamps in ISO format
  - Helps personalities understand conversation flow and respond more appropriately to time-sensitive topics
  - Enables better context awareness in threads and forum posts
  - Format: `[Discord: Server Name > #channel | 2025-07-10T15:30:45Z]`
- **Configuration Command** - New `!tz config` command to control personality settings
  - Toggle context metadata on/off per personality: `!tz config <personality> context-metadata off`
  - Only personality owners can modify settings
  - Settings persist across bot restarts

### Changed
- **Major Architecture Refactoring** - Completed migration from legacy PersonalityManager to Domain-Driven Design
  - Removed entire `src/core/personality/` directory (PersonalityManager, PersonalityRegistry, etc.)
  - All personality operations now use clean DDD patterns through PersonalityApplicationService
  - Improved separation of concerns and testability
  - Reduced codebase by ~5,000 lines while maintaining all functionality

### Fixed
- **Circular Dependencies** - Resolved module loading issues causing "getApplicationBootstrap is not a function" errors
  - Introduced MessageHandlerConfig to break circular dependency chains
  - Fixed aliasResolver to use setter injection pattern
  - Improved module initialization order in ApplicationBootstrap
- **Configuration Persistence** - PersonalityConfiguration now properly saves and loads from disk
  - Fixed FilePersonalityRepository to persist configuration object
  - Updated Personality domain model to handle configuration updates correctly

### Removed
- **Legacy Personality System** - Completely removed deprecated PersonalityManager and related components
  - Deleted PersonalityManager.js, PersonalityRegistry.js, PersonalityValidator.js, PersonalityPersistence.js
  - Removed embedBuilders.js utility (functionality moved to appropriate domain services)
  - Cleaned up all references to legacy system throughout codebase

## [2.0.10] - 2025-07-09

### Fixed
- **Pluralkit Support** - Comprehensive fix for Pluralkit integration issues
  - Fixed authentication to use real user ID instead of webhook ID for Pluralkit messages
  - Added reply tracking system to restore lost Discord references when Pluralkit processes messages
  - Improved proxy message detection using webhookUserTracker for accurate Pluralkit identification
  - Fixed conversation history to show speaker names for Pluralkit messages (e.g., "Name | System: message")
  - Personalities can now differentiate between different Pluralkit proxies from the same Discord user
  - Removed square brackets from proxy message format for cleaner appearance

### Changed
- **Documentation Organization** - Cleaned up root directory
  - Consolidated temporary issue summaries into docs/development/ISSUE_RESOLUTIONS.md
  - Moved coverage reports to docs/testing/coverage-reports/
  - Root directory now only contains essential files (README, CHANGELOG, CLAUDE)

## [2.0.9] - 2025-07-08

### Fixed
- **Avatar URL Access in Threads** - Fixed avatars not showing in thread messages
  - Updated threadHandler.js to access personality.profile.avatarUrl instead of personality.avatarUrl
  - Fixed all remaining instances of direct personality.avatarUrl access throughout codebase
  - Updated avatarManager.js to properly update currentAvatarUrl after fetching
  - Fixed embedBuilders.js createPersonalityInfoEmbed to use personality.profile?.avatarUrl
  - Updated all related tests to use correct DDD personality structure
  - Ensures avatar functionality works correctly in all contexts (channels, threads, embeds)

## [2.0.8] - 2025-07-08

### Fixed
- **Webhook Profile Pictures** - Fixed avatars not showing in Discord webhooks after DDD migration
  - Added avatarStorage initialization to ApplicationBootstrap (was only in legacy PersonalityManager)
  - Added avatar pre-downloading when registering personalities in DDD system
  - Added avatar pre-downloading when refreshing profiles from API
  - Ensures avatars are downloaded and served locally for better reliability

## [2.0.7] - 2025-07-08

### Fixed
- **Webhook Display Names** - Fixed warning "displayName missing for personality" in webhook manager
  - Updated `getStandardizedUsername` to correctly access `personality.profile.displayName` in DDD structure
  - Fixed avatar URL resolution to use `personality.profile.avatarUrl` for proper webhook profile pictures
  - Removed legacy personality structure support as all data has been migrated to DDD
  - Updated all webhook-related tests to use correct DDD personality structure

## [2.0.6] - 2025-07-08

### Fixed
- **Personality Error Messages** - Fixed bug where personalities showed generic error messages instead of personality-specific ones
  - Personality mentions (like `&cold hi`) now work correctly and show proper character responses
  - Resolved "personalityName is required but was not provided" error that caused default bot messages
  - Added backward compatibility for DDD personality system integration
- **Bot Startup Issues** - Resolved critical startup problems that could prevent the bot from functioning
  - Fixed "getApplicationBootstrap is not a function" error during development startup
  - Fixed "ApplicationBootstrap not initialized" errors in production
  - Improved error handling and dependency injection throughout the system

### Changed  
- **Internal Architecture** - Completed migration to Domain-Driven Design (DDD) architecture
  - Removed all feature flags for DDD system (now primary architecture)
  - Converted singleton patterns to factory functions for better testability
  - Standardized repository constructor patterns across the codebase
  - Enhanced logging context for better debugging capabilities

## [2.0.5] - 2025-06-22

### Fixed
- **Status Command** - Fixed -1ms ping display when Discord websocket is not ready
  - Now shows "Calculating..." instead of -1ms when websocket ping is not available
  - Also fixed to use DDD personality service when available instead of legacy registry
- **Debug Command** - Fixed multiple issues with the debug command
  - Fixed "getNsfwVerificationManager is not a function" error when using unverify subcommand
  - Fixed username showing as "undefined" in webhook cache clear logs
  - Added bot owner override so owner can use debug command without admin permissions
- **Ping Command** - Fixed latency always showing 0ms
  - Now correctly uses Discord client websocket ping for actual latency measurement
- **Add Command** - Fixed validation for external personalities
  - External mode now properly validates that personalities exist in the API
  - Fixed hardcoded bot prefixes in help messages
  - Fixed hardcoded @ mention character
  - Fixed tagging options to show aliases first instead of display name
- **Help Command** - Fixed specific command help not using embeds
  - All command help now uses consistent embed formatting
  - Added proper fields for usage, aliases, options, and examples
- **Info Command** - Fixed missing avatar thumbnails in embed responses
  - Command now properly displays personality avatars when available
- **Remove Command** - Fixed missing avatar thumbnails and hardcoded prefixes
  - Command now shows personality avatar in removal confirmation
  - Uses dynamic command prefix throughout messages
- **Alias Resolution** - Fixed precedence order for personality lookups
  - Now correctly follows: exact name > aliases > display name
  - Fixed `&lilith` resolving to wrong personality in some cases
- **CommandContext** - Fixed DM detection for Revolt platform
  - Removed automatic `isDirectMessage` defaulting that interfered with platform-specific logic

### Changed
- **Age Verification Message** - Made error message more helpful
  - Now includes full command with prefix (e.g., `!tz verify`)
  - Explicitly mentions the command must be used in an NSFW channel
  - Helps users understand exactly what they need to do
- **Dynamic Prefix Support** - All DDD commands now use configured bot prefix
  - Removed all hardcoded `!tz` references throughout the codebase
  - Commands now properly display the actual configured prefix in all messages

### Added
- **Phase 2.2 Integration Testing** - Completed comprehensive testing of all 19 commands
  - Created detailed testing checklist documenting all functionality
  - Added helper scripts for integration testing
  - Documented and fixed all 17 issues found during testing

## [2.0.4] - 2025-06-21

### Fixed
- **DDD Personality Error Messages** - Fixed bug where personality-specific error messages weren't being used when DDD is enabled
  - Updated `aiErrorHandler` to check DDD feature flag and use PersonalityRouter when enabled
  - Fixed `PersonalityRouter._convertDDDToLegacyFormat` to include the `errorMessage` field
  - Empty response errors now correctly use personality-specific error messages in DDD mode
  - Added comprehensive tests for both legacy and DDD error handling paths

## [2.0.3] - 2025-06-20

### Fixed
- **Feature Flag Loading** - Fixed critical bug where hyphenated feature flags couldn't be loaded from environment variables
  - Flags like `enhanced-context`, `comparison-testing`, and `dual-write` now properly load when set via environment
  - Added special handling in `FeatureFlags._loadFromEnvironment()` to correctly map underscores to hyphens
  - This fix enables proper feature flag configuration in production environments

### Changed
- **Feature Flag Cleanup** - Removed 15 unused feature flags from the codebase
  - Removed flags that were defined but never referenced in code
  - Removed `ddd.commands.hideLegacy` flag that was only used in an empty TODO
  - Simplified configuration and reduced memory footprint
  - Updated all affected tests to work without the removed flags
- **Command Routing Simplification** - Completely simplified DDD command routing logic
  - When `ddd.commands.enabled` is true, all commands route to the new system
  - Removed non-functional override logic for command-specific and category flags
  - Removed unused `resolveCommandName()` and `getCommandCategory()` methods
  - Removed unused `resetCommandIntegrationAdapter()` and `reset()` testing utilities
  - Makes the system much simpler to understand and maintain
- **Documentation Optimization** - Reduced CLAUDE.md file size by 30%
  - Condensed verbose sections while preserving all critical information
  - Preserved personality section as requested
  - Improved readability with more concise formatting
- **Configuration Cleanup** - Simplified .env.ddd-testing
  - Removed all command-specific feature flags since global flag handles everything
  - Kept only essential DDD system flags

## [2.0.2] - 2025-06-20

### Fixed
- **Multi-Word Alias Validation** - Fixed critical bug preventing multi-word aliases from loading
  - Removed strict validation that rejected leading/trailing spaces in Alias domain model
  - Multi-word aliases like "angel dust" and "melek taus" now load correctly from stored data
  - Leading and trailing spaces are now silently trimmed when creating aliases (preserving spaces in middle)
  - Resolves FilePersonalityRepository hydration errors that prevented personality loading
  - Enables proper Discord message parsing for multi-word mentions like `@Angel Dust hi`

## [2.0.1] - 2025-06-20

### Fixed
- **Personality Alias Conflict Resolution** - Fixed regression where personality seeding would fail when display name aliases conflicted
  - Personality seeding now generates unique aliases when conflicts occur, replicating legacy system behavior
  - Smart alias generation tries using parts of full personality name (e.g., "claude" → "claude-3" for "claude-3-sonnet")
  - Falls back to random suffix generation if smart aliases are also taken
  - Prevents personality seeding failures that occurred in v2.0.0
- **Multi-Word Alias Support** - Enhanced support for multi-word aliases in DDD command system
  - Fixed alias detection and resolution for phrases like "angel dust" or "claude opus"
  - Centralized alias resolution logic to ensure consistency across all command handlers
  - DDD commands now properly support complex multi-word personality references
- **Privacy Enhancements** - Improved privacy by reducing logged user information
  - Moved Discord user IDs from INFO to DEBUG level logging to reduce exposure in production logs
  - Maintains debugging capability while improving user privacy
  - Updated test expectations to match new logging levels
- **DDD System Improvements** - Multiple fixes for the new DDD architecture
  - Fixed `PurgbotCommand` to use correct context properties for DDD system integration
  - Updated message handler tests to use `resolvePersonality` instead of deprecated `getPersonalityByAlias`
  - Ensured `PersonalityProfile` value objects with identical data are properly considered equal
  - Prevented tests from accidentally writing to production `personalities.json` file
- **Command Alias Routing** - Fixed issue where command aliases would route to legacy system instead of DDD system
  - Aliases like `cleandm` for `purgbot` now correctly route to the new DDD command system when enabled
  - Added proper alias resolution in CommandIntegrationAdapter to check the primary command name for category routing

### Changed
- **Documentation Updates** - Enhanced development workflow documentation
  - Added rebase strategy documentation for release merges to main branch
  - Updated LICENSE file for 2025

## [2.0.0] - 2025-06-19

### Added
- **🏗️ Complete DDD Architecture Implementation** - Major infrastructure transformation with Domain-Driven Design
  - Built comprehensive dual-architecture system with feature flag controls
  - **18 commands reimplemented** with modern DDD patterns and clean architecture
  - **4 bounded contexts**: Personality, Conversation, Authentication, AI Integration
  - **50+ feature flags** for granular rollout control and safe deployment
  - **Zero downtime migration**: Legacy system handles 100% of traffic while DDD system runs in parallel
  - Event-driven communication and dependency injection throughout
  - Enhanced error handling, logging, and standardized Discord embed responses

- **📦 Enhanced Backup System** - Complete overhaul with ZIP file generation
  - **ZIP file delivery**: Backup data now organized and delivered as compressed ZIP files
  - **Incremental uploads**: Large backups automatically split into multiple incremental ZIP files
  - **Complete chat history**: Full conversation history backup beyond 50-message limit
  - **Bulk backup categories**: Support for `recent` and `self` personality categories
  - **Better Discord limits handling**: Improved handling of Discord embed size limitations

- **🧪 Comprehensive Testing Infrastructure** - Major testing overhaul
  - **254 test suites** with **4,283+ individual tests** (all passing)
  - **Enhanced mock system** with consistent patterns and automated verification
  - **Performance focus**: All tests run under 30 seconds with fake timers
  - **Anti-pattern detection**: Automated checks for testing best practices
  - **Injectable timer patterns**: Eliminates slow tests caused by real delays

- **🚀 Feature Flag System** - Complete feature management implementation
  - **50+ feature flags** for granular control of new functionality
  - **Environment-based configuration**: Easy deployment and rollback management
  - **Category-based rollout**: Enable by command type (utility, personality, conversation, auth)
  - **Safety mechanisms**: Automatic fallback to legacy system on errors
  - **Development/production separation**: Different flag sets per environment

- **📚 Comprehensive Documentation** - 60+ new documentation files
  - Complete DDD implementation guides and architecture overviews
  - Feature flag reference documentation and migration guides
  - Testing best practices and development workflow documentation
  - Architecture decision records and design pattern documentation

- **🛠️ Enhanced Developer Experience** - Improved tooling and quality enforcement
  - **Pre-commit hooks** with automated quality checks and pattern enforcement
  - **Module size limits** and complexity monitoring to prevent large files
  - **Timer pattern enforcement** to ensure testable code patterns
  - **Mock system improvements** with better type safety and verification

- **Extended Personality Profile** - Enhanced domain model for comprehensive personality data
  - Added `ExtendedPersonalityProfile` class supporting voice config, image settings, and moderation flags
  - Enhanced `PersonalityProfile` with `publicApiData` property to capture additional API fields
  - Prepared foundation for migration from external API to local implementation

- **Automatic Personality Data Migration** - Seamless migration from backup data
  - Added `PersonalityDataRepository` for automatic backup detection in `data/personalities/`
  - Created `PersonalityDataService` providing unified access to personality data
  - Implemented lazy migration converting backup data to ExtendedPersonalityProfile on first access
  - No manual intervention required - migration happens transparently

- **Enhanced AI Context** (Preview) - Rich contextual information for AI responses
  - Automatically includes chat history, memories, and knowledge when enabled
  - Controlled by `features.enhanced-context` feature flag (disabled by default)
  - Enable with `FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT=true` when using alternate AI services
  - Provides up to 10 recent messages, 5 memories, and 3 knowledge items in context

### Fixed
- **🔐 Enhanced Security & Authentication** - Multiple security and stability improvements
  - **DDD-aware personality lookups**: Enhanced personality resolution for replies and references
  - **Enhanced NSFW verification**: Better thread support and edge case handling
  - **Improved ownership validation**: Better validation across all backup operations
  - **Better rate limiting**: Increased personality seeding rate limit from 3s to 6s to prevent 529 errors

- **📊 Message Handling Improvements** - Better message processing and deduplication
  - **Enhanced message deduplication**: Multiple layers of duplicate prevention
  - **Better webhook management**: Improved webhook creation and caching
  - **Enhanced error tracking**: Better error logging and context preservation
  - **Improved thread support**: Better handling of thread messages and replies

- **🔧 Code Quality & Architecture** - Major code quality improvements
  - **Eliminated singleton patterns**: Converted to factory functions and dependency injection
  - **Injectable dependencies**: All timers, delays, and external dependencies now injectable
  - **Modular architecture**: Clear boundaries and separation of concerns
  - **Better foundation for addressing technical debt**: DDD system provides clean patterns for future improvements

### Changed
- **🏗️ Architecture Evolution** - Preparation for future migration
  - **Dual-system approach**: Both legacy and DDD systems running in parallel
  - **Feature flag controlled**: All new functionality controlled by feature flags
  - **Backward compatibility**: All existing functionality preserved and unchanged
  - **Migration preparation**: Infrastructure ready for future cutover to DDD system

- **📈 Performance & Reliability** - Enhanced system performance
  - **Better resource management**: Improved memory usage and cleanup
  - **Enhanced error recovery**: Better error handling and recovery mechanisms
  - **Improved logging**: More detailed and structured logging throughout
  - **Better monitoring**: Enhanced metrics and observability

- **🧪 Development Workflow** - Improved development experience
  - **Enhanced testing patterns**: Standardized test structures and best practices
  - **Better mock management**: Consistent mock patterns across all tests
  - **Automated quality gates**: Pre-commit hooks prevent common issues
  - **Documentation standards**: Comprehensive documentation for all new features

### Technical Details
- **201 commits** between versions with **564 files** modified
- **90,341 insertions** and **20,471 deletions** showing massive transformation
- **Major version**: DDD system will be activated in production via feature flags
- **Production ready**: New DDD system fully tested and ready for deployment

### Breaking Changes
- **Architecture Migration**: While user-facing functionality remains identical, the underlying architecture has been completely rebuilt with DDD patterns
- **Feature Flag Activation**: DDD system will be enabled in production, representing a major architectural change
- **Command System**: All commands now run on the new DDD architecture (transparent to users)
- **Enhanced Error Handling**: Some error messages and responses may be formatted differently due to standardized Discord embed responses

## [1.3.2] - 2025-06-06

### Fixed
- **Release Notification Categorization** - Fixed incorrect categorization of changelog sections
  - "Changed" sections no longer appear as "Breaking Changes" in notifications
  - Changed sections now correctly display under "Other Changes" with a wrench icon
  - Prevents confusion when patch releases show breaking changes warnings

## [1.3.1] - 2025-06-06

### Changed
- **Environment Variable Standardization** - Simplified configuration across environments (#84)
  - Unified variable names (removed DEV-specific variants like `DISCORD_DEV_TOKEN`)
  - All bot-specific variables now use `BOT_` prefix for consistency
  - Added configurable bot settings: `BOT_NAME`, `BOT_PREFIX`, `BOT_MENTION_CHAR`
  - Updated `.env.example` with complete variable list and descriptions
  - No user-facing changes - internal configuration improvement only

## [1.3.0] - 2025-06-06

### Added
- **Local Avatar Storage System** - Bot now downloads and serves personality avatars locally (#79)
  - Prevents Discord from blocking external avatar URLs
  - Implements lazy loading with checksum-based change detection
  - Serves avatars via HTTP endpoint at `/avatars`
  - Automatically migrates existing personalities on first use
  - Full support for thread messages and webhook messages

### Fixed
- **Critical: Duplicate AI Request Prevention** - Enhanced request deduplication to prevent multiple API calls (#78)
  - Adds Discord message ID to request tracking for better uniqueness
  - Implements content hashing for improved deduplication
  - Fixes issue where single Discord message could trigger 2-3 AI responses
  - Should resolve cases where bot processes messages multiple times but only shows last response
- **Avatar Content Type Handling** - Support for `application/octet-stream` responses
  - Handles generic binary content types when URL has valid image extension
  - Fixes avatar download failures from external service APIs
- **HTTP Server Deployment** - Resolved Railway deployment issues
  - Fixed port configuration mismatch (now uses PORT=3000)
  - Added root path handler for health checks
  - Enhanced error logging with defensive socket property access
  - Server now properly binds to 0.0.0.0 for external access
- **Thread Message Avatar Resolution** - Fixed missing avatar storage in thread handler
  - Thread messages now use local avatar URLs consistently
  - Eliminates code duplication between regular and thread message paths

### Changed
- **Timer Pattern Enforcement** - Enhanced test infrastructure
  - Timer pattern checker now detects indirect timer usage
  - Added test timeout detection to pre-commit hooks
  - Prevents future CI failures from unmocked timers

## [1.2.1] - 2025-06-06

### Fixed
- **First-run notification system** - Fixed multiple issues preventing first-time users from receiving release notifications (#72, #73, #75)
  - Clear orphaned version files when no notifications have been sent
  - Migrate existing authenticated users to notification system on startup
  - Fixed `getAllReleases is not a function` error by using correct `getReleasesBetween` method
  - Ensure first-run notifications include current version and up to 5 recent releases
- **Mock verification system** - Added automated verification that mocked methods exist in real implementations (#74)
  - Prevents production bugs from testing non-existent methods
  - New pre-commit hook and npm script for mock validation
- **Dynamic bot prefix** - Replaced all 9 remaining hardcoded bot prefixes with dynamic configuration (#76)
  - Fixed prefixes in verify command and DM handler
  - Updated all test files to use dynamic prefix
  - Ensures correct prefix display in both production (!tz) and development (!rtz)

### Added
- Comprehensive test coverage for notification system edge cases
- Mock method verification script and documentation
- Hardcoded prefix detection script with pre-commit enforcement

## [1.2.0] - 2025-06-05

### Added
- **Modular HTTP Server** - New lightweight HTTP server infrastructure for health checks and webhooks (#69)
  - Health check endpoint at `/health` with comprehensive system metrics
  - GitHub webhook endpoint at `/webhook/github` for automated release notifications
  - Modular route registration system for easy extensibility
  - Full CORS support and OPTIONS preflight handling
- **Comprehensive Test Coverage** - Major improvements to HTTP server and route testing (#70)
  - HTTP server tests: 88% coverage (new)
  - Health route tests: 97% coverage (new)
  - Webhook route tests: 76% coverage (was 0% functional)
  - Overall routes coverage increased from 38% to 82%
- **Multi-Release Notification Support** - Bot can now handle multiple rapid releases gracefully
  - Batches multiple releases into single notification
  - Prevents notification spam during rapid deployments

### Fixed
- **Critical**: Discord status display bug - Status 0 (READY) was incorrectly showing as DISCONNECTED in health checks
- Webhook route tests converted from callback-style to promise-based async patterns
- All ESLint `jest/no-done-callback` errors in webhook tests

### Changed
- Added `createGitHubWebhookHandler` export for better testability of webhook routes
- Improved GitHubReleaseClient version filtering logic

## [1.1.0] - 2025-06-05

### Added
- **Release Notification System** - Bot now automatically notifies authenticated users via DM when new versions are deployed (#65)
  - Automatic version checking on bot startup
  - Opt-in by default with customizable preferences
  - Notification levels: major, minor, patch
  - Conditional messaging based on user interaction history
  - GitHub API integration for fetching release notes
  - New command: `!tz notifications` to manage preferences
- Enhanced versioning documentation with Discord bot-specific guidance

### Fixed
- **Personality error messages** - Custom error messages now properly display for all error types including empty_response (#64)
- Added lazy loading for personalities missing the errorMessage field (registered before the feature existed)

### Changed
- Updated anti-pattern checker to better handle fs.promises operations

## [1.0.2] - 2025-06-05

### Fixed
- **Critical**: Webhook personality detection for usernames with pipe characters - handles usernames like "Desidara | תשב" (#62)
- **Critical**: Race condition in AI service causing duplicate API calls and message duplication (#61)

### Changed
- Improved webhook username parsing to extract base name before pipe character
- Increased AI request timeout from 1 minute to 5 minutes for slow API responses
- Fixed function calls from refactor (`listPersonalitiesForUser` → `getAllPersonalities`)

### Added
- Comprehensive test coverage for webhook username parsing (24 new tests)
- Documentation for webhook personality detection patterns

## [1.0.1] - 2025-06-04

### Fixed
- **Critical**: Remove command parameter order bug - users can now successfully remove personalities (#59)
- Fixed test parameter calls in info command tests to match actual PersonalityManager API

## [1.0.0] - 2025-06-04

### Added
- Personality-specific error messages - errors now use personality-appropriate responses (#54)
- Enhanced debug commands:
  - `!tz debug unverify` - for testing NSFW verification flows
  - `!tz debug testpersonality` - for testing personality error messages
  - `!tz debug webhook` - for webhook debugging
- Comprehensive test coverage for thread NSFW verification (15 new tests)

### Fixed
- **Critical**: Add command parameter order bug - users can now properly add personalities (#56)
- **Critical**: NSFW verification for threads and forums - threads now inherit NSFW status from parent channels (#57)
- NSFW verification requirement for DMs - DMs now properly require verification (#53)
- Webhook handling and various NSFW verification edge cases (#52)

### Changed
- Improved NSFW error messages with clearer instructions
- Enhanced debug output formatting

## [0.1.0] - Initial Release

### Added
- Core Discord bot functionality with webhook personality system
- Basic command system
- NSFW verification system
- Personality management
- Authentication system