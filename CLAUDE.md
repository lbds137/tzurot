# Tzurot Bot - Project Configuration

@~/.claude/CLAUDE.md

> **⚠️ CRITICAL PR WORKFLOW**: **NEVER** create PRs directly to `main` branch! Always target `develop` for features, fixes, and updates. Only sync develop→main for releases. See [Git and PR Workflow](docs/development/GIT_AND_PR_WORKFLOW.md).

## Project Overview

Tzurot is a Discord bot that uses webhooks to represent multiple AI personalities. It allows users to add personalities and interact with them through Discord channels. Built with Node.js and Discord.js.

## Tech Stack
- Node.js 20.x
- Discord.js 14.x  
- Jest for testing
- Nodemon for development
- DDD architecture migration in progress
- Primary language: JavaScript (no TypeScript)

## Project Structure
```
src/
├── bot.js                    # Discord entry point
├── domain/                   # DDD domain models
├── application/              # DDD services & commands
├── adapters/                 # External integrations  
├── infrastructure/           # Framework-specific code
├── handlers/                 # Legacy message handlers
└── utils/                    # Shared utilities

tests/
├── unit/                     # Unit tests (<500ms each)
├── __mocks__/               # Consolidated mock system
└── setup.js                 # Global test setup
```

## Essential Commands

### Development
```bash
npm run dev                  # Start with nodemon (auto-restart)
npm run quality              # Run all quality checks (lint, format, timers)
npm test                     # Run all tests
npm run test:watch          # Run tests in watch mode
npx jest tests/unit/path/to/test.js  # Run specific test
```

### Git Workflow  
```bash
git sync-develop            # Sync develop with main after merging
gh pr create --base develop --title "type: description"  # Create PR
```

### Scripts Directory
See `./scripts/` for additional tools:
- Quality enforcement scripts (timers, anti-patterns, module size)
- Testing utilities (coverage, performance analysis)
- Git workflow helpers
- Database maintenance tools

## Code Style - Tzurot Specific

**Format**: 2 spaces • camelCase vars/functions • PascalCase classes • Single quotes • Semicolons • 100 char lines

**Files**: <1000 lines target • <500 lines enforced • Break large files • JSDoc exports

**Critical Patterns**:
- Never hardcode bot prefixes - import `botPrefix` from config
- Injectable timers only - no direct setTimeout/setInterval
- Singleton exports forbidden - use factory functions
- No NODE_ENV checks in source - use dependency injection

### Anti-Patterns Enforced by CI
1. **Singleton Exports** - Will fail pre-commit hooks
2. **NODE_ENV Checks** - Use dependency injection instead  
3. **Timer Existence Checks** - Inject timers as dependencies
4. **Hardcoded Prefixes** - Always use config values

See migration guides:
- `docs/testing/TIMER_PATTERNS_COMPLETE.md`
- `docs/improvements/SINGLETON_MIGRATION_GUIDE.md`

## Architecture - Tzurot Specific

### Core Components
1. **Bot (`bot.js`)**: Main Discord entry point - routes messages, supports guild/DM channels, deduplicates responses
2. **Personality Manager (`personalityManager.js`)**: Manages AI personalities, aliases, and persistence
3. **Webhook Manager (`webhookManager.js`)**: Creates/caches webhooks, splits large messages, handles media, provides DM fallback
4. **AI Service (`aiService.js`)**: AI API interface with error handling and multimodal support (text/image/audio)
5. **Conversation Manager (`conversationManager.js`)**: Tracks active conversations and message-personality mappings
6. **Commands System**: Modular handlers in `src/commands/handlers/` with auth/permission middleware
7. **Media Handling**: Central (`mediaHandler.js`), audio (`audioHandler.js`), and image (`imageHandler.js`) processors

### Data Flow
1. Discord message → `bot.js` → route based on: command prefix / reply / @mention / active conversation
2. AI generation: `aiService.js` → AI API → `webhookManager.js` → Discord (with conversation tracking)

## Critical Patterns - Tzurot Specific

### Performance & Rate Limits
- **Webhook caching**: Reduces Discord API calls (critical for rate limits)
- **Profile caching**: Reduces AI API calls (expensive operations)  
- **Message deduplication**: Multiple layers prevent duplicate processing
- **Avatar storage**: Serves locally to reduce external requests

### Message Deduplication Layers
1. Request-level deduplication in aiService.js
2. Message tracking in messageTracker.js
3. Webhook message tracking
Each layer serves a specific purpose - maintain all of them

### Media Handling
- System supports audio and image attachments
- References to media (like replies) require special handling
- DM channels require different media handling than guild channels
- Always validate media URLs before processing
- Implement size limits for media processing

### Error Boundaries
- Multiple layers of error handling implemented
- Never remove error boundaries without understanding purpose
- Log all errors with appropriate context
- Implement retries with exponential backoff for external calls

## Git Workflow - Tzurot Specific

### 🚨 PR RULES: NEVER TO MAIN (except releases/hotfixes)!

**Branch Strategy**: 
- `feature/` → `develop` → `main`
- One feature = One branch
- Branches live <1 week
- Conventional commits required

### 🚨 NEVER DELETE BRANCHES WITHOUT PERMISSION!

**Required checks before branch operations**:
```bash
git status && git log --oneline -5 && git diff origin/branch && git branch -vv
```

**If branch exists**: Ask user OR use different name OR update existing

## Security - Tzurot Specific

### Authentication & Authorization
- **Never log or expose API keys/tokens** in any form
- Always validate user permissions before executing commands
- Use environment variables for all sensitive configuration
- Implement rate limiting on all external API calls
- Always use X-User-Auth header for user-specific requests

### Data Privacy
- Never store or log real user data in tests
- Use generic test data (test@example.com, @TestUser)
- Respect Discord's privacy guidelines
- **Follow**: `docs/development/PRIVACY_LOGGING_GUIDE.md`

## Tzurot-Specific Lessons Learned

### 2025-07-08 - Lost Avatar Functionality in DDD Migration

**What Happened**: DDD refactor lost avatar downloading/serving. Webhooks stopped showing avatars.

**Root Cause**: 
- avatarStorage.initialize() only called in legacy PersonalityManager
- PersonalityApplicationService never pre-downloaded avatars

**Prevention**:
```bash
# Before ANY refactor:
grep -r "initialize\|startup\|bootstrap" src/
# Document EVERY initialization step
```

### 2025-07-16 - DDD Authentication Migration Broke Core Features

**What Happened**: 
- Bot hitting OpenAI instead of user's service (401 errors)
- Duplicate bot responses  
- 45+ test failures

**Root Cause**:
- createAIClient() method not implemented in new auth service
- Return value changed from `isAuthorized` to `allowed`
- Missing AI service routing initialization

**Prevention**:
- Test actual Discord bot behavior, not just unit tests
- Verify API endpoints remain unchanged
- Check return value formats match exactly

### 2025-07-08 - Exposed Vendor Dispute in Changelog

**What Happened**: Put "Discord blocking X vendor" in public changelog

**Prevention**: 
- NEVER mention vendor disputes in public docs
- NEVER expose business relationships
- Just describe technical fixes

## Tool Permissions - Tzurot Specific

### Approved (No Permission Needed)
- `npm run` commands (dev, test, lint, format, quality)
- File operations (read, write, edit)
- Search tools (grep, search, Task)
- All MCP tools
- Package inspection (`npm list`, `npm audit`)

### Requires Approval
- Adding/removing npm dependencies
- Modifying package.json dependencies
- Core config changes (.eslintrc, jest.config.js)
- Git push operations (triggers deployment)
- Branch creation/deletion

## Testing Guidelines - Tzurot Specific

### Performance Requirements
- Test suite must run in <30 seconds
- Individual test files <5 seconds
- Always mock I/O operations
- Use fake timers for all delays

### Tzurot Test Patterns
- Use `createMigrationHelper()` for DDD tests
- Use `presets.commandTest()` for command tests
- See test documentation for patterns

### Required After Changes
1. Run `npm run quality` - checks code, formatting, patterns
2. Run `npm test` - verify functionality
3. Update `docs/testing/TEST_COVERAGE_SUMMARY.md` with coverage
4. Pre-commit hooks run automatically on staged files

## Versioning - Tzurot Specific

See `docs/development/VERSIONING.md` for Discord bot versioning guidance.

### Quick Reference
- **PATCH**: Bug fixes (1.2.0 → 1.2.1)
- **MINOR**: New features (1.2.0 → 1.3.0)  
- **MAJOR**: Breaking changes (1.2.0 → 2.0.0)

### Release Process
1. Create `release/vX.Y.Z` from develop
2. Update version in package.json
3. Run `npm install` to update package-lock.json
4. Update CHANGELOG.md
5. PR to main (only time allowed)
6. After merge: `echo "y" | ./scripts/create-release.sh vX.Y.Z`

## Import Key Project Docs
@docs/development/GIT_AND_PR_WORKFLOW.md
@docs/testing/TIMER_PATTERNS_COMPLETE.md
@docs/development/PRIVACY_LOGGING_GUIDE.md
@docs/development/VERSIONING.md
@package.json