# v2 Features to Port to v3

**Last Updated**: 2025-10-23

This document tracks v2 features that should be reimplemented in v3 for feature parity.

## Priority 1: Critical for Production

### Avatar Image Storage System
**Status**: ❌ Not Started
**v2 Implementation**: `tzurot-legacy/` (avatar storage service)
**Why Needed**: Currently using shapes.inc URLs for Discord webhook avatars - need self-hosted solution

**Requirements**:
- HTTP server in bot-client to serve static avatar images
- Railway volume or cloud storage for avatar files
- Image CDN/caching for Discord webhook performance
- Migration script to download existing avatars from shapes.inc

**Implementation Notes**:
- bot-client needs `PORT` variable (already configured)
- Need public Railway domain for bot-client service
- Store avatars in `/avatars/{personality-id}.png` format
- Update webhook manager to use self-hosted URLs

**Related Variables**:
- ✅ `PORT` - Already set on bot-client
- ❌ Need Railway public domain for bot-client

---

### BYOK (Bring Your Own Key) System
**Status**: ❌ Not Started
**Why Needed**: **BLOCKER FOR PUBLIC LAUNCH** - Without this, bot owner pays for all API usage

**Requirements**:
- User-provided API keys stored in PostgreSQL
- Encryption at rest (using `ENCRYPTION_KEY` env var)
- Per-user rate limiting
- API key validation and error handling
- Admin dashboard to monitor usage/costs

**Implementation Notes**:
- Add `api_keys` table to Prisma schema
- Encrypt keys before storing: `AES-256-GCM` with `ENCRYPTION_KEY`
- Update ai-worker to use user's key instead of global key
- Add `/api/keys` endpoints for users to manage their keys

**Security**:
- Keys encrypted in database
- Only decrypt when making AI API calls
- Never log or expose keys in responses
- Rotate `ENCRYPTION_KEY` requires re-encryption of all keys

---

## Priority 2: Quality of Life

### GitHub Webhook Version Notifications
**Status**: ⚠️ Partially Ready
**v2 Implementation**: `tzurot-legacy/` (webhook endpoint + notification system)

**Requirements**:
- HTTP endpoint in bot-client to receive GitHub webhooks
- Parse GitHub release webhook payloads
- Send Discord DM to bot owner on new releases
- Version comparison logic (don't spam for every commit)

**Implementation Notes**:
- Webhook URL: `https://{bot-client-domain}/webhooks/github`
- Use existing `GITHUB_WEBHOOK_SECRET` for signature validation
- Send notification format: "🎉 New release: v3.1.0 - [Release Notes](link)"

**Related Variables**:
- ✅ `GITHUB_WEBHOOK_SECRET` - Already preserved
- ✅ `BOT_OWNER_ID` - Already set (for DM target)

---

### Backup/Migration Command
**Status**: ❌ Not Started
**v2 Implementation**: `/backup personality` command in `tzurot-legacy/`

**Requirements**:
- Export conversation history from PostgreSQL
- Export personality vectors from Qdrant
- Export personality configurations (JSON)
- Create portable backup format (ZIP with JSON/CSV)
- Send via Discord DM or upload to cloud storage

**Implementation Notes**:
- Command: `/backup [personality|all|history|memory]`
- Export format: ZIP containing:
  ```
  backup-2025-10-23/
  ├── metadata.json
  ├── conversations.csv
  ├── personalities/
  │   ├── lilith.json
  │   └── ...
  └── vectors/
      └── qdrant-export.json
  ```

**Use Cases**:
- User migration between bot instances
- Data portability/GDPR compliance
- Disaster recovery
- Testing with production-like data

---

## Priority 3: Nice to Have

### Admin Commands for Bot Owner
**Status**: ⚠️ Partially Implemented
**Existing**: `/ping`, `/help`
**v2 Had**: `/admin servers`, `/admin kick`, `/admin usage`

**Requirements**:
- `/admin servers` - List all servers bot is in
- `/admin kick <server_id>` - Remove bot from specific server
- `/admin usage` - Show API usage stats (when BYOK implemented)
- `/admin health` - Check all services status
- `/admin deploy` - Trigger Railway deployment (if possible via API)

**Implementation Notes**:
- Restrict to `BOT_OWNER_ID` only
- Use Discord.js guild collection for server list
- Integration with Railway API for deployment info

---

### Enhanced Context/Memory Controls
**Status**: ⚠️ Discussion Needed
**v2 Had**: `FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT` (removed as env var)

**Requirements**:
- User-level or per-personality memory toggle
- "Forget me" command for privacy
- Memory search/query commands
- Memory summary generation

**Implementation Notes**:
- Store user preference in PostgreSQL `user_preferences` table
- Default: Memory enabled for all
- Users can opt-out: `/memory off`
- Personality-level: Some personalities could be stateless by design

---

## Not Porting (v2 Legacy)

### ❌ Shapes.inc Integration
- **Status**: Service shut down
- **v3 Alternative**: OpenRouter + Gemini (vendor-agnostic)

### ❌ v2 Command Prefix System
- **Status**: Replaced with Discord slash commands
- **v3 Alternative**: Native Discord slash commands + @mentions

### ❌ v2 DDD Architecture
- **Status**: Over-engineered for one-person project
- **v3 Alternative**: Simple microservices with clean classes

---

## Implementation Order Recommendation

1. **Avatar Storage** (needed for webhooks to work properly)
2. **Admin Commands** (quality of life for bot management)
3. **GitHub Webhook Notifications** (already have secret, just need endpoint)
4. **Backup/Migration** (data portability)
5. **BYOK System** (required before public launch)
6. **Memory Controls** (nice to have, users can request)

---

## Related Documentation

- [shapes.inc Credentials](../migration/SHAPES_INC_CREDENTIALS.md) - Preserved API credentials
- [V2 Feature Tracking](../V2_FEATURE_TRACKING.md) - What's already ported
- [Architecture Decisions](../ARCHITECTURE_DECISIONS.md) - Why v3 is different

---

## Notes

- All new features should follow v3's simple architecture (no DDD)
- Use Discord.js 14.x slash commands (not v2's message-based commands)
- Prioritize vendor-agnostic implementations
- Test in development Railway environment before prod launch
