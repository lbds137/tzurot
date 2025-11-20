# Scripts Directory

This directory contains utility scripts for development, testing, and maintenance of the Tzurot bot.

## Most Commonly Used Scripts

### Git Workflow
- **`git sync-develop`** - Git alias to sync develop with main after any merge
- **`./sync-develop.sh`** - Shell script version of the sync command
- **`./create-release.sh`** - Automated GitHub release creation script

### Development
- **`npm run dev`** - Start development server (uses start-dev.js internally)
- **`npm run quality`** - Run all quality checks before committing
- **`./setup-pre-commit.sh`** - Set up git hooks for automatic quality checks

### Testing
- **`npm test`** - Run full test suite
- **`npx jest path/to/test.js`** - Run specific test file
- **`./test-commands.sh`** - Test all bot commands

## Script Categories

### Quality Enforcement
- `check-timer-patterns.js` - Ensures timers are injectable for testing
- `check-test-antipatterns.js` - Detects common test anti-patterns
- `check-module-size.sh` - Prevents files from exceeding 500 lines
- `check-singleton-exports.js` - Detects singleton anti-patterns
- `comprehensive-test-timing-analysis.js` - Analyzes test performance

### Git & SSH Setup
- `setup-ssh.sh` - Configure SSH for GitHub (Steam Deck specific)
- `git-with-ssh.sh` - Helper for git commands with SSH key handling
- `setup-pre-commit.sh` - Install pre-commit hooks

### Test Infrastructure
- `check-mock-consistency.js` - Verify mock usage patterns
- `check-test-mock-patterns.js` - Enforce new mock patterns
- `check-test-timeouts.js` - Ensure proper test timeouts
- `migrate-to-consolidated-mocks.js` - Migrate to new mock system
- `generate-mock-migration-report.js` - Track mock migration progress

### Database & Cleanup
- `cleanup_test_personalities.js` - Remove test personalities from DB
- `verify_message_tracker.js` - Test message tracking functionality
- `rollback_deduplication.sh` - Rollback deduplication changes if needed

### Analysis & Reporting
- `analyze-test-structure.js` - Analyze test organization
- `identify-slow-tests.js` - Find performance bottlenecks in tests
- `update-coverage-summary.js` - Update test coverage docs

### Bot Testing
- `test-commands.sh` - Test all bot commands
- `test-standardized-commands.sh` - Test command patterns
- `check-thread-activation.js` - Verify thread functionality

### Documentation
- `reorganize_docs.js` - Reorganize documentation structure

## Usage Examples

### Before Committing
```bash
# Run quality checks
npm run quality

# Or manually:
node scripts/check-timer-patterns.js
node scripts/check-test-antipatterns.js
./scripts/check-module-size.sh
```

### After Merging to Main
```bash
# Sync develop with main
git sync-develop
# or
./scripts/sync-develop.sh
```

### Setting Up Development Environment
```bash
# Set up SSH (Steam Deck)
./scripts/setup-ssh.sh

# Set up pre-commit hooks
./scripts/setup-pre-commit.sh
```

### Analyzing Tests
```bash
# Find slow tests
node scripts/identify-slow-tests.js

# Check test patterns
node scripts/check-test-antipatterns.js

# Analyze test structure
node scripts/analyze-test-structure.js
```

## Adding New Scripts

When adding new scripts:
1. Make shell scripts executable: `chmod +x script-name.sh`
2. Add a descriptive comment at the top of the file
3. Update this README with the script's purpose
4. Update `/CLAUDE.md` if the script is commonly used

## Script Naming Conventions
- Use kebab-case for all scripts
- `.sh` extension for shell scripts
- `.js` extension for Node.js scripts
- Descriptive names that indicate the script's purpose