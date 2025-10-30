# 🎯 Current Work

> Last updated: 2025-10-29

## Status: v2 Personality Import (In Progress)

**Branch**: `feat/v2-personality-import`
**Focus**: Importing all 66 v2 personalities from shapes.inc backups into v3 database + Qdrant memory

**Important**: Do NOT run personality imports until this branch is merged - we don't want personalities available without their memories.

### Import Progress (2025-10-29)

**Current Status**: Paused due to AWS/Qdrant service issues

**What's Complete**:
- ✅ Fixed v3 mention regex to support multi-word names (@Angel Dust, @Bambi Prime)
- ✅ Updated import scripts to use global default system prompt + LLM config
- ✅ Created bulk import script with memory migration
- ✅ **27 personalities** fully imported with memories
- ✅ **Lila** partially imported (~1,767 memories, stuck on AWS timeout)
- ✅ Duplicate Emily renamed to "Emily (Fallen)"
- ✅ Added `--skip-existing` flag to avoid re-generating embeddings (saves OpenAI credits)

**Issues Encountered**:
- ❌ **Amaterasu** - Avatar too large (138 KB exceeds database column limit)
- ❌ **Bambi Prime** - Avatar too large (95 KB exceeds database column limit)
- ⏸️ **Lila** - Import stuck on Qdrant timeouts (AWS us-east-1 issues today)
- ⏸️ **33 personalities** not yet attempted

**Personalities with completed memory imports** (saved to `scripts/import-personality/completed-personalities.txt`):
adora, alastor, andrew, angel-dust, aria, ashley, azazel, bambi, baphomet, bartzabel, beelzebub, borunol, bune, catra, cerridwen, charlie, data, dionysus, disposal-chute, eido, emberlynn, emily-seraph, ereshkigal, eris, haniel, hecate, hyun-ae

### Next Steps (Resume Tomorrow When AWS/Qdrant Stable)

**Step 1: Finish personality configs** (no memories, quick)
```bash
# Use Railway-provided DATABASE_URL environment variable
npx tsx scripts/import-personality/bulk-import.ts --skip-memories
```
This will create all 66 personality database entries without importing memories.

**Step 2: Complete Lila's memories** (resume where it left off, no duplicates)
```bash
# Use Railway-provided DATABASE_URL environment variable
pnpm import-personality lila-ani-tzuratech --memories-only --skip-existing
```
The `--skip-existing` flag checks Qdrant before generating embeddings, avoiding waste of OpenAI credits on the ~1,767 memories already imported.

**Step 3: Import remaining memories**
Create a script to loop through all personalities, skipping the 27 that completed:
```bash
# Read completed list
COMPLETED=$(cat scripts/import-personality/completed-personalities.txt)

# Get all personality slugs
ALL=$(ls tzurot-legacy/data/personalities/)

# Import memories for personalities not in completed list
for slug in $ALL; do
  if ! grep -q "$slug" scripts/import-personality/completed-personalities.txt; then
    echo "Importing memories for $slug..."
    pnpm import-personality "$slug" --memories-only --skip-existing
  fi
done
```

**Step 4: Fix avatar size issues**
Two options:
1. Resize Amaterasu and Bambi Prime avatars before import (compress PNGs)
2. Increase database column size for `avatar_data` (requires migration)

**Step 5: Fix @Bambi Prime tagging** ✅ **COMPLETE**
~~Current issue: `@Bambi Prime` triggers `@Bambi` due to single-word matching first.~~
Fix applied: Reversed mention regex to try multi-word matches BEFORE single-word matches (prioritizes longest match).
File: `services/bot-client/src/handlers/MessageHandler.ts:findPersonalityMention()` (line 414)
Commit: `6291128` on `feat/v2-personality-import` branch

### Files Modified Today
- `services/bot-client/src/handlers/MessageHandler.ts` - Added multi-word mention support, then reversed order to prioritize longest matches
- `scripts/import-personality/import-personality.ts` - Added `--skip-existing` flag
- `scripts/import-personality/bulk-import.ts` - Created bulk import script
- `scripts/import-personality/MemoryImporter.ts` - Added `checkMemoryExists()` to skip existing memories
- `scripts/import-personality/completed-personalities.txt` - List of personalities with complete memory imports

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

## Recent Completed Work

**Code Quality Audit** (2025-10-25, merged):
- ✅ Created centralized TIMEOUTS, INTERVALS, TEXT_LIMITS constants
- ✅ Created enums for MessageRole, JobStatus, AttachmentType
- ✅ Replaced all magic numbers throughout codebase
- ✅ Standardized file naming (PascalCase for class exports)
- ✅ Moved image resizing to api-gateway (architectural improvement)

**v3.0.0-alpha.5 Release** (2025-10-25):
- ✅ Fixed completely broken retry mechanism (errors now propagate correctly)
- ✅ Refactored retry logic to clean loop instead of nested ifs
- ✅ Fixed duplicate placeholder entries in conversation history

**v3.0.0-alpha.4 Release** (2025-10-25):
- ✅ Fixed LangChain timeout bug (moved timeout to invoke() call)
- ✅ Added third retry pass for industry-standard 3 total attempts
- ✅ Increased gateway timeout from 240s to 270s

## Quick Links to Relevant Docs

### Current Work
- [scripts/import-personality/](scripts/import-personality/) - Import scripts and utilities
- [scripts/import-personality/completed-personalities.txt](scripts/import-personality/completed-personalities.txt) - List of completed imports
- [bulk-import.log](bulk-import.log) - Import log (too large for Git)

### v3 Documentation
- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way
- [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md) - How to deploy to Railway
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - What's ported vs. what's not
- [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md) - Local development setup

### Always Relevant
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

## Public Endpoints

- **API Gateway**: https://api-gateway-development-83e8.up.railway.app
- **Health Check**: https://api-gateway-development-83e8.up.railway.app/health

## Priorities After Import Complete

Once all 66 personalities are imported with memories:
1. **Fix @Bambi Prime tagging** - Multi-word mentions triggering single-word matches
2. **Deploy to production** - All personalities available for testing
3. **Port remaining v2 features**:
   - Auto-response system (activated channels)
   - Full slash command suite
   - Rate limiting
   - NSFW verification
4. **BYOK implementation** - Required before public launch

---

*This file is updated whenever switching focus. It reflects the actual state of the project, not aspirational goals.*
