# Tzurot v3 - Phased Implementation Plan

> **Created**: 2025-11-22
> **Status**: Planning Phase
> **Related**: [Schema Improvements Proposal](schema-improvements-proposal.md), [LLM Hyperparameters Research](../architecture/llm-hyperparameters-research.md)

## Overview

This document outlines a phased approach to implementing major v3 improvements, broken down into manageable increments to avoid scope overwhelm while delivering critical features.

**Total Scope**: 3 phases over ~25-30 development sessions

## Current Production Status (Before Migration)

**Database**: 67 personalities in production
- 66 from shapes.inc migration (all have `errorMessage` in `custom_fields`)
- 1 created on new platform (no shapes.inc-specific data)

**Current Schema Limitations**:
- ❌ No BYOK - bot owner pays all API costs (blocks public launch)
- ❌ No usage tracking - can't prevent infrastructure abuse
- ❌ No aliases - personalities can't have multiple mention triggers
- ❌ No voice settings - voice synthesis exists but not configurable
- ❌ No user preferences - can't override voice/timezone settings
- ❌ LlmConfig doesn't support reasoning models (Claude 3.7, OpenAI o1/o3, Gemini 3.0 Pro)
- ❌ Custom fields like `errorMessage` stored in JSON (should be dedicated columns)

## Phase 1: BYOK + Critical Schema Migration 🚨 PRODUCTION BLOCKER

**Estimated Time**: 15-18 sessions (increased from 12-15 due to Prisma 7.0 migration)
**Status**: Planning
**Goal**: Unblock public launch by implementing BYOK and migrating critical shapes.inc data

### Why This Phase First
- **BYOK blocks public launch** - without it, random users can rack up expensive API bills
- Migrates existing production data (66 personalities)
- Enables modern AI features (reasoning models)
- **Prisma 7.0 migration** - Consolidates all database schema changes into one phase
- Relatively focused scope (no new feature development)

### Database Changes

**Prisma 7.0 Migration** (PREREQUISITE - Do First):
- Upgrade Prisma from 6.x → 7.0.0
- Change `schema.prisma` provider: `prisma-client-js` → `prisma-client`
- Add `output` path for generated client (move out of node_modules)
- Update 20+ files to import from new generated path
- Benefits: ~90% smaller bundles, 3x faster queries, ESM-first
- Estimated: 2-3 sessions for migration + testing

**New Tables**:
1. **UserApiKey** - Encrypted API key storage (AES-256-GCM)
   - One key per provider per user
   - Encrypted at rest (iv, content, tag columns)
   - Validation before storage
   - Hierarchical inheritance (user wallet → persona override)

2. **UsageLog** - Token usage tracking
   - Tracks text/voice/image requests
   - Prevents infrastructure abuse even with BYOK
   - Rate limiting based on token usage

3. **PersonalityAlias** - Unique aliases across personalities
   - Extract from shapes.inc backups
   - Unique constraint on alias
   - Enables multiple mention triggers per personality

**Table Updates**:
4. **Personality** - Add dedicated columns
   - `errorMessage` (String?, Text) - Move from `custom_fields.errorMessage` (66 personalities)
   - `birthday` (DateTime?, Date) - Extract from shapes.inc backups
   - Relationships: `aliases`, `voiceConfig` (future)

5. **User** - Add user preferences
   - `timezone` (String, default "UTC") - For time-aware personality responses
   - Relationships: `apiKeys`, `usageLogs`

6. **LlmConfig** - Hybrid schema refactor
   - Add `provider` (String, default "openrouter")
   - Add `advancedParameters` (JSONB, default "{}")
   - Add `maxReferencedMessages` (Int, default 10)
   - Migrate existing columns (topK, frequencyPenalty, etc.) → JSONB
   - Drop old columns after migration
   - Supports reasoning models (Claude 3.7, OpenAI o1/o3, Gemini 3.0 Pro thinking_level)

### Data Migration

**From Current Production DB**:
- Move `custom_fields.errorMessage` → `Personality.errorMessage` (66 personalities)

**From shapes.inc Backups** (`tzurot-legacy/data/`):
- Extract aliases → PersonalityAlias table (66 personalities)
- Extract birthdays → Personality.birthday (66 personalities)
- Extract any missing errorMessages (1 new personality)

**LlmConfig Migration**:
- Migrate existing provider-specific params to `advancedParameters` JSONB
- Preserve all existing data (zero data loss)

### Application Code Changes

**Core Infrastructure**:
- [ ] Create encryption utilities (`packages/common-types/src/utils/encryption.ts`)
  - AES-256-GCM encrypt/decrypt functions
  - Master key from Railway environment (`APP_MASTER_KEY`)
- [ ] Add log sanitization middleware
  - Regex: `sk-...`, `sk_...`, `AIza...` → `[REDACTED]`
  - Apply to all services (bot-client, api-gateway, ai-worker)
- [ ] Update ai-worker to accept encrypted API key in job payload
- [ ] Update AI provider clients to decrypt and use user keys
- [ ] Add key validation service (dry run API calls before storage)

**Zod Validation Schemas**:
- [ ] Create LLM `advancedParameters` schemas (per provider)
  - OpenAI: reasoningEffort, maxCompletionTokens, frequencyPenalty, etc.
  - Anthropic: topK, thinking.budgetTokens, cacheControl, etc.
  - Gemini: topK, safetySettings, thinking_level (Gemini 3.0 Pro), etc.
  - OpenRouter: minP, topA, typicalP, repetitionPenalty, etc.
- [ ] Add business logic constraints (e.g., Claude 3.7 thinking requires temperature=1.0)

**Discord Commands**:
- [ ] `/wallet set <provider>` - Modal input (ephemeral, secure)
- [ ] `/wallet list` - Show configured providers (ephemeral)
- [ ] `/wallet remove <provider>` - Delete API key
- [ ] `/wallet test <provider>` - Validate key still works
- [ ] `/timezone set` - Dropdown of common timezones (user-level setting)
- [ ] `/timezone get` - Show current timezone
- [ ] `/usage` - Daily/weekly/monthly token stats

**Personality System**:
- [ ] Update personality creation to handle aliases (uniqueness check)
- [ ] Update personality deletion to cascade (aliases)
- [ ] Update mention detection to query PersonalityAlias table
- [ ] Update error handling to use `Personality.errorMessage` column
- [ ] Update personality context to include user timezone

**AI Service**:
- [ ] Update AI service to read `advancedParameters` from JSONB
- [ ] Add support for reasoning parameters (Claude 3.7, OpenAI o1/o3, Gemini 3.0 Pro)
- [ ] Implement parameter validation per provider

**Usage Tracking & Rate Limiting**:
- [ ] Add usage logging to ai-worker (text requests)
- [ ] Add rate limiting middleware based on usage logs
- [ ] Add admin command to view global usage stats

### Testing

**Unit Tests**:
- [ ] Test encryption/decryption utilities (AES-256-GCM)
- [ ] Test log sanitization (API keys redacted)
- [ ] Test alias uniqueness constraint enforcement
- [ ] Test timezone validation (IANA database)
- [ ] Test LLM `advancedParameters` Zod validation (all providers)
- [ ] Test reasoning parameter constraints (Claude 3.7 thinking+temperature)

**Integration Tests**:
- [ ] Test BYOK flow: set key → validate → encrypt → store → use → decrypt
- [ ] Test key validation failures (invalid key, quota exceeded)
- [ ] Test hierarchical inheritance (user wallet → persona override)
- [ ] Test personality deletion cascades (aliases)
- [ ] Test usage logging for text requests
- [ ] Test rate limiting enforcement

**Migration Tests**:
- [ ] Test migration scripts with 66 shapes.inc personalities
- [ ] Verify no data loss (aliases, errorMessages, birthdays)
- [ ] Test rollback procedure

### Documentation

**User-Facing**:
- [ ] User guide for `/wallet` commands (how to get API keys)
- [ ] User guide for `/timezone` command
- [ ] Document provider costs (OpenRouter, OpenAI, Gemini) for transparency

**Developer**:
- [ ] Document `advancedParameters` JSONB structure (per provider)
- [ ] Document encryption key rotation procedure
- [ ] Document migration process and rollback procedures
- [ ] Update CHANGELOG.md with breaking changes
- [ ] Update CURRENT_WORK.md with Phase 1 completion

**Security**:
- [ ] Document API key storage security (AES-256-GCM)
- [ ] Document log sanitization patterns
- [ ] Document Discord security best practices (ephemeral, modals)

### Success Criteria

- ✅ Users can add their own API keys via `/wallet` commands
- ✅ API keys are encrypted at rest (verified in DB)
- ✅ Logs are sanitized (no API keys visible in Railway logs)
- ✅ All 66 shapes.inc personalities migrated successfully
- ✅ Aliases working (multiple mention triggers per personality)
- ✅ Custom error messages displaying correctly
- ✅ Usage tracking operational
- ✅ LlmConfig supports reasoning models (Gemini 3.0 Pro `thinking_level`, etc.)
- ✅ All tests passing (unit + integration + migration)
- ✅ Zero data loss verified

### Rollback Plan

1. **Database Rollback**: Use Prisma migrate rollback to previous migration
2. **Data Recovery**: Restore from pre-migration backup (full DB snapshot)
3. **Application Rollback**: Revert to git commit before schema changes
4. **Verification**: Confirm personalities table has 67 records with intact `custom_fields`

**CRITICAL**: Take full database backup before starting migration!

---

## Phase 2: Voice Enhancements

**Estimated Time**: 5-7 sessions
**Status**: Future (after Phase 1 complete)
**Goal**: Enhance existing voice synthesis with user controls and voice cloning

### Why This Phase Second
- Builds on existing voice feature (already partially implemented)
- User-requested functionality (voice overrides)
- Manageable scope
- Not a production blocker

### Database Changes

**New Tables**:
1. **VoiceConfig** - ElevenLabs voice settings (personality-level)
   - `voiceId` (String) - ElevenLabs voice ID
   - `voiceModel` (String, default "eleven_flash_v2_5")
   - `stability` (Decimal 0.00-1.00, default 0.5)
   - `similarity` (Decimal 0.00-1.00, default 0.75)
   - `style` (Decimal 0.00-1.00, default 0.0)
   - `frequency` (Decimal 0.00-1.00, default 0.0)

2. **VoiceConfigSample** - Voice cloning samples
   - `personalityId` (FK)
   - `sampleData` (bytea) - Binary audio data (like avatars)
   - `fileSize` (Int) - Enforce 10MB limit (Instant Voice Cloning max)
   - `mimeType` (String) - 'audio/mp3' or 'audio/wav'
   - `duration` (Int) - Audio duration in seconds
   - Up to 25 samples per personality

3. **UserPreferences** - User-level overrides
   - `userId` (FK)
   - `voiceEnabled` (Boolean?) - User override for voice (null = use personality default)
   - Future: other user preferences (imageEnabled, etc.)

**Table Updates**:
4. **Personality** - Update relationships
   - `voiceConfig` (1:1 relationship to VoiceConfig)
   - Remove `voiceSettings` JSON column (replace with VoiceConfig table)

### Data Migration

**From shapes.inc Backups**:
- Extract voice settings → VoiceConfig table (66 personalities with voice data)
  - `voice_id`, `voice_model`, `voice_stability`, `voice_similarity`, `voice_style`, `voice_frequency`
- Validate all parameter ranges (0.0-1.0)

**Voice Samples**: None to migrate (new feature - users will upload)

### Application Code Changes

**Voice Synthesis**:
- [ ] Update voice synthesis service to query VoiceConfig table
- [ ] Add voice sample upload endpoint (validate size ≤10MB, format MP3/WAV)
- [ ] Add ElevenLabs Instant Voice Cloning integration
- [ ] Implement user preference override logic (UserPreferences.voiceEnabled → Personality.voiceEnabled)

**Discord Commands**:
- [ ] `/voice enable` - Enable voice for current user (override)
- [ ] `/voice disable` - Disable voice for current user (override)
- [ ] `/voice reset` - Remove user override (use personality default)
- [ ] (Admin) `/personality voice-sample upload <personality> <file>` - Upload voice sample

**Validation**:
- [ ] Add Zod schema for VoiceConfig parameter ranges (0.0-1.0)
- [ ] Add file size validation (10MB max)
- [ ] Add file format validation (MP3 192kbps+, WAV)

### Testing

**Unit Tests**:
- [ ] Test voice config parameter validation (0.0-1.0 ranges)
- [ ] Test file size validation (10MB limit)
- [ ] Test file format validation (MP3/WAV)
- [ ] Test user override hierarchy (user → personality)

**Integration Tests**:
- [ ] Test voice synthesis with VoiceConfig table
- [ ] Test voice sample upload end-to-end
- [ ] Test user preference overrides (enable/disable/reset)
- [ ] Test personality deletion cascades (voice config, samples)

### Documentation

**User-Facing**:
- [ ] User guide for `/voice` commands
- [ ] Document voice sample requirements (10MB, MP3/WAV, 2-3 minutes optimal)

**Developer**:
- [ ] Document VoiceConfig schema and ElevenLabs integration
- [ ] Update CHANGELOG.md
- [ ] Update CURRENT_WORK.md

### Success Criteria

- ✅ All 66 personalities have voice settings migrated to VoiceConfig table
- ✅ Users can override voice settings via `/voice` commands
- ✅ Voice samples can be uploaded (≤10MB, MP3/WAV validated)
- ✅ Voice synthesis uses VoiceConfig + user overrides correctly
- ✅ All tests passing
- ✅ Zero data loss verified

---

## Phase 3: Image Generation (FUTURE)

**Estimated Time**: TBD - depends on agentic infrastructure
**Status**: On Hold - requires tool call architecture
**Goal**: Add image generation capabilities using tool calls

### Why This Phase Later
- **Requires agentic infrastructure** (tool calls, multi-step reasoning)
- Limited provider support (OpenRouter only has Gemini image models, not DALL-E/Flux/SD)
- Better to wait and do it right with tool calls rather than rush

### Blockers

1. **Tool Call Architecture**: Need to implement tool calling framework
2. **Provider Limitations**: OpenRouter doesn't support DALL-E 3, Flux, or Stable Diffusion
   - Only Gemini 2.5/3.0 Flash/Pro image models available
   - Would need direct OpenAI API for DALL-E (adds complexity)
3. **Scope**: Natural language → tool selection → image generation flow is substantial

### Research Completed

**Validated via WebSearch**:
- [OpenRouter Image Generation Docs](https://openrouter.ai/docs/features/multimodal/image-generation)
- OpenRouter supports: Gemini 2.5/3.0 Flash/Pro Image, GPT-5 Image
- OpenRouter does NOT support: DALL-E 3, Flux, Stable Diffusion

### Potential Future Approach

When ready to implement:
1. Build tool calling infrastructure (function calling, multi-step reasoning)
2. Start with Gemini image models (available on OpenRouter)
3. Add `/imagine` command that uses tool calls
4. Consider direct OpenAI API integration for DALL-E 3 (if needed)
5. ImageConfig table with JSONB for provider-specific params (similar to LlmConfig)

**Decision**: Defer until agentic infrastructure is ready

---

## Implementation Timeline

### Phase 1 (PRODUCTION BLOCKER)
**Weeks 1-4**: Database migrations + encryption infrastructure
- Prisma migrations (UserApiKey, UsageLog, PersonalityAlias, schema updates)
- Data migration scripts (66 personalities)
- Encryption utilities + log sanitization

**Weeks 5-7**: Discord commands + BYOK flow
- `/wallet` command group (set, list, remove, test)
- `/timezone` command (set, get)
- `/usage` command (stats)
- Key validation service

**Week 8**: Testing + deployment
- Unit + integration + migration tests
- Railway deployment
- Smoke testing in development
- Documentation

**Total**: ~12-15 sessions

### Phase 2 (ENHANCEMENT)
**Weeks 9-11**: Voice enhancements
- VoiceConfig + VoiceConfigSample + UserPreferences tables
- Voice settings migration (66 personalities)
- Voice sample upload endpoint
- `/voice` commands (enable, disable, reset)
- Testing + deployment

**Total**: ~5-7 sessions

### Phase 3 (FUTURE)
**Timeline**: TBD - blocked on agentic infrastructure

---

## Risk Mitigation

### Phase 1 Risks
- **Data Loss**: Mitigate with full DB backup + rollback plan
- **Encryption Key Loss**: Document key rotation procedure, backup master key
- **Migration Failures**: Test with production dump, verify all 66 personalities
- **API Key Leakage**: Log sanitization + ephemeral Discord responses

### Phase 2 Risks
- **File Upload Exploits**: Validate file size, format, magic bytes
- **Voice Sample Quality**: Document requirements (2-3 minutes, clear audio)

### Phase 3 Risks
- **Tool Call Complexity**: Defer until infrastructure ready

---

## Success Metrics

### Phase 1
- [ ] Public launch unblocked (BYOK operational)
- [ ] Users providing their own API keys (bot owner not paying)
- [ ] Usage tracking operational (can monitor infrastructure abuse)
- [ ] Modern AI models supported (Claude 3.7, Gemini 3.0 Pro thinking_level)

### Phase 2
- [ ] Voice synthesis configurable (66 personalities with settings)
- [ ] Users can override voice preferences

### Phase 3
- [ ] Defer - revisit when agentic infrastructure ready

---

## References

- [Schema Improvements Proposal](schema-improvements-proposal.md) - Detailed schema changes
- [LLM Hyperparameters Research](../architecture/llm-hyperparameters-research.md) - Advanced parameters
- [BYOK Research Sources](schema-improvements-proposal.md#7-userapikey-table---byok-support-production-blocker) - AES-256-GCM validation
- [ElevenLabs Voice Cloning Docs](https://elevenlabs.io/docs/cookbooks/voices/instant-voice-cloning) - File size limits
- [OpenRouter Image Generation](https://openrouter.ai/docs/features/multimodal/image-generation) - Available models
