# Changelog

All notable changes to the Tzurot Discord bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - Prevents Discord from blocking external avatar URLs (shapes.inc domain)
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
  - Fixes avatar download failures from shapes.inc API
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