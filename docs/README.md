# Tzurot Documentation

This directory contains the documentation for the Tzurot Discord bot project.

## 📁 Structure

### `/core` - Core Documentation
Essential documentation for understanding and working with the system:
- **SETUP.md** - Getting started guide
- **ARCHITECTURE.md** - System design and component overview
- **API_REFERENCE.md** - API endpoints and interfaces
- **DEPLOYMENT.md** - Deployment instructions
- **TROUBLESHOOTING.md** - Common issues and solutions
- **SECURITY.md** - Security guidelines and best practices
- **MESSAGE_FORMAT_SPECIFICATION.md** - Message format details
- **COMMANDS.md** - Command reference and usage
- **COMMAND_ARCHITECTURE.md** - Command system design

### `/components` - Feature Documentation
Documentation for specific features and components:
- **AUTHENTICATION.md** - Authentication system details
- **AUDIO_ATTACHMENT.md** - Audio handling capabilities
- **DEDUPLICATION.md** - Message deduplication system
- **DISPLAY_NAME_ALIASES.md** - Personality alias system
- **EMBED_UTILITIES.md** - Discord embed handling
- **IMAGE_HANDLING.md** - Image processing features
- **MEDIA_HANDLING_SYSTEM.md** - Overall media system
- **PLURALKIT_PROXY_HANDLING.md** - PluralKit integration
- **SPACE_ALIASES.md** - Space-based alias handling

### `/testing` - Testing Documentation
Testing guidelines and coverage information:
- **README.md** - Testing overview
- **BEHAVIOR_BASED_TESTING.md** - Testing philosophy
- **TEST_ANTIPATTERNS_REFERENCE.md** - Anti-patterns to avoid
- **TIMER_PATTERNS_COMPLETE.md** - Complete guide for timer patterns, testing, and migration
- **TEST_COVERAGE_SUMMARY.md** - Current test coverage
- **MANUAL_TESTING_PROCEDURE.md** - Manual testing guide
- **CRITICAL_COVERAGE_GAPS.md** - Areas needing tests
- **COMMANDLOADER_TEST_APPROACH.md** - Command loader testing

### `/improvements` - Future Improvements
Plans and proposals for future enhancements:
- **README.md** - Improvement overview
- **FEATURE_IDEAS.md** - Feature roadmap
- **MODULE_STRUCTURE_PROPOSAL.md** - Proposed refactoring
- **AISERVICE_REFACTORING_PLAN.md** - AI service improvements
- **CODE_IMPROVEMENT_OPPORTUNITIES.md** - Code quality improvements
- **MULTI_USER_SCALABILITY.md** - Scaling considerations
- **REFERENCE_AND_MEDIA_REFACTOR.md** - Media system improvements
- **DOCUMENTATION_ORGANIZATION_PROPOSAL.md** - Doc improvements
- **MULTIPLE_MEDIA_API_FIX.md** - Media API enhancements

### `/development` - Development Guides
Development-specific documentation:
- **TIMER_ENFORCEMENT_GUIDE.md** - Timer pattern enforcement

### `/archive` - Historical Documentation
- **DEVELOPMENT_HISTORY.md** - Archive of all historical fixes and development journey

## 🔍 Where to Find Information

### For New Developers
1. Start with `/core/SETUP.md`
2. Read `/core/ARCHITECTURE.md`
3. Review the root `CLAUDE.md` for coding guidelines

### For Testing
1. Read `tests/CLAUDE.md` for testing guidelines
2. Check `/testing/BEHAVIOR_BASED_TESTING.md` for philosophy
3. Avoid patterns in `/testing/TEST_ANTIPATTERNS_REFERENCE.md`

### For Contributing
1. Read `/core/CONTRIBUTING.md`
2. Check the root `CLAUDE.md` for standards
3. Review `/development/TIMER_ENFORCEMENT_GUIDE.md`

### For Feature Development
1. Check `/components` for existing features
2. Review `/improvements` for planned enhancements
3. Read `src/CLAUDE.md` for source code guidelines

## 📝 Important Notes

- **Primary guidance lives in CLAUDE.md files** (root, src/, tests/)
- Historical fixes are archived in `/archive/DEVELOPMENT_HISTORY.md`
- All new code must follow timer patterns in `/core/TIMER_PATTERNS.md`
- Test anti-patterns are automatically checked by pre-commit hooks

## 🚀 Quick Links

- [Setup Guide](core/SETUP.md)
- [Architecture Overview](core/ARCHITECTURE.md)
- [Testing Guide](testing/README.md)
- [Command Reference](core/COMMANDS.md)
- [Security Guidelines](core/SECURITY.md)