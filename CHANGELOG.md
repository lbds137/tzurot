# Changelog

All notable changes to the Tzurot Discord bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-01-06

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