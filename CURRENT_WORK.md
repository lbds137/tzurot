# 🎯 Current Work

> Last updated: 2025-10-22

## Status: v3 Development Deployment Active

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

## Recent Work (Past 2 Weeks)

Fixing dev deployment issues:
- ✅ Message chunking (Discord 2000 char limit handling)
- ✅ Job timeout scaling based on image count
- ✅ Conversation history timestamp fixes
- ✅ Model indicators and typing indicators
- ✅ Qdrant memory retrieval improvements

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
