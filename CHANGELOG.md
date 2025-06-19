# Changelog

All notable changes to the Tzurot Discord bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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