# Release Test Plan: v3.0.0-beta.89

**Base**: v3.0.0-beta.88 (main)
**Source**: develop (87 commits, 160 files, +8502/-893)
**Epic**: Voice Engine Phases 1–3b

---

## Changes Summary

### Features — Voice Engine (Phases 1–3b)

**Phase 1** — Python service + voice reference storage

- New `services/voice-engine/` Python FastAPI service (Dockerfile, server.py, tests)
- Voice reference upload/download API endpoints
- Voice registration with clone/preset support
- API gateway: voice reference processor, public `/voice-references` route
- Prisma migration: `voice_reference_data` (BYTEA) + `voice_reference_type` columns on `personalities`

**Phase 2** — Python hardening + ai-worker STT integration

- `AudioProcessor` in ai-worker now routes to voice-engine for speech-to-text
- `VoiceTranscriptionService` in bot-client handles Discord voice messages
- `VoiceMessageProcessor` in the message chain transcribes voice attachments
- Forwarded voice message support
- `RedisService` in both ai-worker and bot-client for voice engine URL discovery
- Deployment runbook for voice-engine

**Phase 3a** — TTS pipeline + config cascade

- `TTSStep` in ai-worker pipeline — synthesizes speech after LLM generation
- `VoiceEngineClient` + `VoiceRegistrationService` + `ttsSynthesizer` in ai-worker
- `DiscordResponseSender` updated to attach TTS audio to replies
- Config cascade fields: `voiceEnabled`, `voiceTranscriptionEnabled`
- `voiceEnabled` schema change from `.optional()` to `.default(false)`
- `WebhookManager` updated for audio attachment support
- `HARDCODED_CONFIG_DEFAULTS` extended with voice settings

**Phase 3b** — User-facing voice commands + cascade wiring

- `/character voice` (renamed from `voice-upload`) and `/character voice-clear` slash commands
- SSRF defense-in-depth (Discord CDN hostname allowlist)
- `VoiceMessageProcessor` now uses config cascade instead of `AUTO_TRANSCRIBE_VOICE` env var
- Cache invalidation for voice settings changes
- `AUTO_TRANSCRIBE_VOICE` env var deprecated with startup warning
- Express body limit bumped to 20MB for base64 voice data

**Phase 3b polish** — Voice command UX consistency

- Renamed `/character voice-upload` → `/character voice` (matches `/character avatar` convention)
- Dashboard "Change Voice" action button — ephemeral redirect to `/character voice`
- Dashboard "Toggle Voice" action button — enable/disable TTS without clearing voice reference (only shown when voice reference exists)
- Three-state voice status in dashboard description: nothing / 🎤 Voice On / 🔇 Voice Off
- Extracted `sections.ts` and `dashboardActions.ts` from oversized config/dashboard files
- Made base dashboard config unexported — callers must use `getCharacterDashboardConfig()`
- `hasVoiceReference` guard on voice-toggle for stale session defense

### Bug Fixes (non-voice)

- `fix(api-gateway)`: `formatPersonalityResponse` alignment between create/update
- `fix(api-gateway)`: slug length cap, redundant `Buffer.from()` removal
- `fix(bot-client)`: prevent video attachments triggering voice-only TTS
- `fix(api-gateway)`: AIRoutes integration test mock paths fixed

### Database Migration

- **1 migration**: `20260306230115_add_voice_reference_data`
  - Adds `voice_reference_data BYTEA` and `voice_reference_type VARCHAR(50)` to `personalities`
  - Protected indexes preserved (not dropped)

### CI/Infra

- Python CI workflow for voice-engine (ruff, mypy, pytest)
- Codecov config for Python coverage
- Python coding standards added to `.claude/rules/02-code-standards.md`

---

## Pre-Release Test Plan

### Database

- [ ] Run `pnpm ops db:migrate --env dev` (new migration for voice reference columns)

### Voice Engine Service

- [ ] Deploy `voice-engine` to Railway (new service — needs initial setup)
- [ ] Health check: `GET /health` returns `{"status": "ok"}`
- [ ] Verify `VOICE_ENGINE_URL` is set in ai-worker and bot-client Redis/env

### Voice Transcription (STT)

- [ ] Send a voice message in a channel with an activated personality — should auto-transcribe
- [ ] Send a voice message with a personality mention — should transcribe AND get AI response
- [ ] Verify `voiceTranscriptionEnabled` cascade toggle works (disable via admin settings, voice messages should pass through untranscribed)
- [ ] Send a forwarded voice message — should still transcribe

### Voice Cloning (Upload/Clear)

- [ ] `/character voice` with a WAV/MP3 file — should succeed, reply confirms voice enabled
- [ ] `/character voice` with a non-audio file (image) — should reject
- [ ] `/character voice` with a file >10MB — should reject
- [ ] `/character voice-clear` — should succeed, reply confirms voice disabled
- [ ] Verify autocomplete shows only owned characters for voice commands

### TTS (Text-to-Speech)

- [ ] After uploading a voice reference, send a message to the character — response should include audio attachment
- [ ] After clearing voice reference, responses should be text-only again
- [ ] Verify `voiceEnabled: false` (default) means no TTS for characters without voice references

### Cache Invalidation

- [ ] After `/character voice`, AI response should immediately use TTS (not wait 5 min)
- [ ] After `/character voice-clear`, AI response should immediately stop TTS

### Dashboard Voice Controls

- [ ] Edit dashboard shows "Change Voice" action in select menu
- [ ] Clicking "Change Voice" shows ephemeral message directing to `/character voice` and `/character voice-clear`
- [ ] Edit dashboard shows "Toggle Voice" action only when character has a voice reference
- [ ] Clicking "Toggle Voice" flips voiceEnabled and refreshes dashboard (status changes between 🎤 Voice On / 🔇 Voice Off)
- [ ] Dashboard description shows no voice status when no voice reference exists
- [ ] After `/character voice-clear`, dashboard refresh removes "Toggle Voice" button
- [ ] Admin users see the admin section on the post-create dashboard

### Regression

- [ ] Normal text conversations still work (no voice attachment = no change)
- [ ] Avatar upload/clear still works
- [ ] Character edit dashboard still works (all sections editable, save works)
- [ ] Video attachments don't trigger voice processing
- [ ] `/character voice-clear` still works unchanged
