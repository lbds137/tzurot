# Tzurot Documentation

> **📍 Current Focus**: Testing infrastructure and message formatting refactor - see [Active Work](#-active-work) below

This directory contains the documentation for the Tzurot Discord bot project.

> **🚀 Quick Navigation**: See the [Complete Documentation Index](DOCUMENTATION_INDEX.md) for all documents.

## 🎯 Active Work

### Currently Working On

- **[Testing Infrastructure](testing/TESTING_STRATEGY.md)** - Golden master tests for safe refactoring _(Updated: Aug 2025)_
- **[Formatting Domain Plan](improvements/FORMATTING_DOMAIN_PLAN.md)** - Next: Pipeline pattern for messages _(Updated: Aug 2025)_

### Essential References

- **[Git & PR Workflow](development/GIT_AND_PR_WORKFLOW.md)** ⚠️ Never PR to main directly!
- **[Timer Patterns](testing/TIMER_PATTERNS_COMPLETE.md)** - Required for all new code
- **[CLAUDE.md](../CLAUDE.md)** - AI assistant context and rules

## 📁 Structure

### `/core` - Core Documentation

Essential documentation for understanding and working with the system:

- **SETUP.md** - Getting started guide
- **ARCHITECTURE.md** - Legacy system architecture (currently active)
- **API_REFERENCE.md** - API endpoints and interfaces
- **DEPLOYMENT.md** - Deployment instructions
- **TROUBLESHOOTING.md** - Common issues and solutions
- **SECURITY.md** - Security guidelines and best practices
- **MESSAGE_FORMAT_SPECIFICATION.md** - Message format details
- **COMMAND_SYSTEM.md** - Complete command system documentation

### `/architecture` - Architecture Documentation

- **ARCHITECTURE_OVERVIEW_2025-06-18.md** - Complete view of both legacy (active) and DDD (built, inactive) systems
- **CORE_INTERACTION_FLOW.md** - Detailed interaction flows

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

- **README.md** - Testing overview and quick start
- **TEST_PHILOSOPHY_AND_PATTERNS.md** - Testing philosophy, behavior-based testing, anti-patterns
- **MOCK_SYSTEM_GUIDE.md** - Mock patterns, verification, and migration
- **TESTING_CASE_STUDIES.md** - Bug case studies and lessons learned
- **TIMER_PATTERNS_COMPLETE.md** - Complete guide for timer patterns, testing, and migration
- **TEST_COVERAGE_SUMMARY.md** - Current test coverage
- **MANUAL_TESTING_PROCEDURE.md** - Manual testing guide
- **CRITICAL_COVERAGE_GAPS.md** - Areas needing tests
- **COMMANDLOADER_TEST_APPROACH.md** - Command loader testing

### `/improvements` - Improvement Tracking

Organized by status and priority:

- **README.md** - Overview of improvement organization
- **active/** - Currently in-progress DDD migration work
  - **FEATURE_FREEZE_NOTICE.md** - Feature freeze during DDD migration
  - **TECHNICAL_DEBT_INVENTORY.md** - Debt being addressed by DDD
  - **WORK_IN_PROGRESS.md** - Current incomplete tasks
- **post-ddd/** - Frozen improvements awaiting DDD completion
  - **POST_DDD_ROADMAP.md** - Prioritized implementation plan
  - **DATABASE_MIGRATION_PLAN.md** - PostgreSQL migration (high priority)
  - **PROFILE_DATA_ENHANCEMENT.md** - Enhanced AI features
  - **FEATURE_IDEAS.md** - New feature proposals

### `/ddd` - Domain-Driven Design Documentation

Complete DDD migration documentation:

- **README.md** - DDD overview and phase status
- **DDD_ACTUAL_STATUS_2025-06-18.md** - Current state (built but inactive)
- **DDD_ENABLEMENT_GUIDE.md** - How to activate DDD features
- **DDD_DEPLOYMENT_GUIDE.md** - Production deployment guide
- **DOMAIN_DRIVEN_DESIGN_PLAN.md** - Original design plan
- **DDD_PHASE_3_PROGRESS.md** - Phase 3 completion details
- **DDD_PHASE_4_PLAN.md** - Current phase plan

### `/development` - Development Guides

Development-specific documentation:

- **GIT_AND_PR_WORKFLOW.md** - Complete git workflow, PR rules, and branch management
- **GITHUB_RELEASES.md** - Release process and automation
- **PREFIX_HANDLING_GUIDE.md** - Handling bot prefixes correctly
- **VERSIONING.md** - Semantic versioning guidelines

### `/archive` - Historical Documentation

- **DEVELOPMENT_HISTORY.md** - Archive of all historical fixes and development journey

## 🔍 Where to Find Information

### For New Developers

1. Start with `/core/SETUP.md`
2. Read `/core/ARCHITECTURE.md`
3. Review the root `CLAUDE.md` for coding guidelines

### For Testing

1. Read `/testing/TEST_PHILOSOPHY_AND_PATTERNS.md` for philosophy and anti-patterns
2. Check `/testing/MOCK_SYSTEM_GUIDE.md` for mock patterns
3. Review `/testing/TIMER_PATTERNS_COMPLETE.md` for timer testing

### For Contributing

1. Read `/core/CONTRIBUTING.md`
2. Check `/development/GIT_AND_PR_WORKFLOW.md` for workflow
3. Review the root `CLAUDE.md` for coding standards

### For Feature Development

1. Check `/components` for existing features
2. Review `/improvements` for planned enhancements
3. Read `src/CLAUDE.md` for source code guidelines

## 📝 Important Notes

- **Primary guidance lives in CLAUDE.md files** (root, src/, tests/)
- Historical fixes are archived in `/archive/DEVELOPMENT_HISTORY.md`
- All new code must follow timer patterns in `/testing/TIMER_PATTERNS_COMPLETE.md`
- Test anti-patterns are automatically checked by pre-commit hooks

## 🚀 Quick Links

- [Setup Guide](core/SETUP.md)
- [Architecture Overview - Complete](architecture/ARCHITECTURE_OVERVIEW_2025-06-18.md)
- [Architecture - Legacy System](core/ARCHITECTURE.md)
- [DDD Status & Enablement](ddd/DDD_ACTUAL_STATUS_2025-06-18.md)
- [Testing Guide](testing/README.md)
- [Command System](core/COMMAND_SYSTEM.md)
- [Security Guidelines](core/SECURITY.md)
