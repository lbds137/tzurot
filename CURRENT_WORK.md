# 🎯 Current Work

> Last updated: 2025-10-25

## Status: Code Quality Audit & Cleanup

**Branch**: `chore/code-quality-audit`
**Focus**: Consolidating constants, reducing magic numbers, preparing for future unit testing

**v3 has been deployed and running on Railway for 14+ days (development environment)**

- Branch: `feat/v3-continued`
- Environment: Railway "development" environment (private testing)
- Status: Stable and operational
- **NOT PUBLIC**: All API costs currently on owner's dime, no BYOK yet

## What v3 Actually Has Working

### ✅ Core Infrastructure
- TypeScript monorepo with pnpm workspaces
- Three microservices deployed on Railway:
  - **api-gateway**: HTTP API + BullMQ job queue
  - **ai-worker**: AI processing with Qdrant memory
  - **bot-client**: Discord.js client with webhooks
- PostgreSQL + Redis + Qdrant vector database
- OpenRouter + Gemini AI providers

### ✅ Features Working in Dev Deployment
- @personality mentions (@lilith, @default, @sarcastic)
- Reply detection (reply to bot messages to continue conversation)
- Webhook management (unique avatar/name per personality)
- Message chunking (handles Discord's 2000 char limit)
- Conversation history tracking
- Long-term memory via Qdrant vectors
- Image attachment support
- Voice transcription support
- Model indicator in responses
- Persistent typing indicators
- Basic slash commands (/ping, /help)

### 📋 Not Yet Ported from v2
- Auto-response (activated channels)
- Full slash command system (/personality add/remove/list/info)
- Rate limiting
- NSFW verification
- Request deduplication

### 🚧 Blockers for Public Production Launch
**Critical** (required before public use):
- **BYOK (Bring Your Own Key)**: Users must provide their own OpenRouter/Gemini API keys
- **Admin Commands**: Bot owner needs slash commands to:
  - `/admin servers` - List all servers bot is currently in
  - `/admin kick <server_id>` - Force remove bot from a server
  - `/admin usage` - View API usage and costs per server/user

**Important** (nice to have):
- Cost tracking/alerting per user
- Usage quotas to prevent abuse
- Better error messages for missing API keys

## Current Focus: Code Quality Audit - Phase 1 Complete ✅

**Branch**: `chore/code-quality-audit`
**Goal**: Improve code maintainability and prepare for unit testing phase

**Phase 1 Status**: ✅ **COMPLETED**
- ✅ Created centralized TIMEOUTS constants (30s, 270s, 120s vision/job timeouts)
- ✅ Created INTERVALS constants (cache TTLs, cleanup intervals)
- ✅ Created TEXT_LIMITS constants (log preview lengths, truncation limits)
- ✅ Created enums for MessageRole, JobStatus, AttachmentType
- ✅ Replaced all magic numbers throughout codebase (15+ across 9 files)
- ✅ Standardized file naming (PascalCase for class exports)
- ✅ Moved image resizing to api-gateway (architectural improvement)
- ✅ Removed dead code (isDiscordUrlExpired, fetchAsBase64)

**Next Steps**: Review, test on Railway, merge when ready. Phase 2-3 deferred.

**See**: [CODE_QUALITY_AUDIT.md](docs/CODE_QUALITY_AUDIT.md) for full findings and recommendations

## Recent Work (Past Week)

**v3.0.0-alpha.5 Release** (2025-10-25):
- ✅ Fixed completely broken retry mechanism (errors now propagate correctly)
- ✅ Refactored retry logic to clean loop instead of nested ifs
- ✅ Fixed duplicate placeholder entries in conversation history
- ✅ Improved logging with attempt numbers and retry flags

**v3.0.0-alpha.4 Release** (2025-10-25):
- ✅ Fixed LangChain timeout bug (moved timeout to invoke() call)
- ✅ Added third retry pass for industry-standard 3 total attempts
- ✅ Increased gateway timeout from 240s to 270s
- ✅ Added filename context to attachment descriptions

## Quick Links to Relevant Docs

### v3 Documentation
- [Architecture Decisions](ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way
- [Deployment Guide](DEPLOYMENT.md) - How to deploy to Railway
- [v2 Feature Tracking](V2_FEATURE_TRACKING.md) - What's ported vs. what's not
- [Development Guide](DEVELOPMENT.md) - Local development setup

### Always Relevant
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

## Public Endpoints

- **API Gateway**: https://api-gateway-development-83e8.up.railway.app
- **Health Check**: https://api-gateway-development-83e8.up.railway.app/health

## Next Steps (When Ready to Continue)

Priority features to port from v2:
1. Auto-response system (activated channels)
2. Full slash command suite
3. Rate limiting
4. NSFW verification

---

*This file is updated whenever switching focus. It reflects the actual state of the project, not aspirational goals.*
