# Current

> **Session**: 2026-03-10
> **Version**: v3.0.0-beta.90

---

## Session Goal

_Beta.90 release — ElevenLabs BYOK hardening fixes from dev testing._

## Active Task

Version bumped to beta.90. Creating release PR.

---

## Completed This Session

- **fix(api-gateway,bot-client)**: Detect ElevenLabs scoped-key permission errors — parse `missing_permissions` status from 401 response, return descriptive error listing required permissions
- **fix(common-types,bot-client)**: Trim whitespace from API key input
- **fix(ai-worker)**: Auto-reclone ElevenLabs voice on 404 (stale cache after `/settings voices clear`) — `invalidateVoice()` + catch-retry in TTSStep
- **fix(bot-client,api-gateway,common-types)**: Pass userId to transcribe endpoint for BYOK STT key resolution — was hardcoded as 'system'

## Previous Session

- **feat(ai-worker,api-gateway,bot-client)**: Configurable ElevenLabs TTS model — config cascade, `/settings voices model` with autocomplete, `elevenLabsListModels`, TTSStep wiring
- **refactor(ai-worker,api-gateway,bot-client)**: CPD reduction — `voiceReferenceHelper.ts`, `elevenLabsFetch.ts`, `storeTTSResult`, audio extraction reuse, `fetchEditableCharacter` (152→146 clones, -124 lines)
- **fix(api-gateway)**: WAV fallback warning log on voice reference MIME type
- **chore(ci)**: `mypy --strict` extended to voice-engine tests
- **docs**: Deleted completed 1694-line voice-engine proposal doc

## Recent Releases

- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening: scoped-key detection, voice auto-reclone, STT userId fix, TTS model config
- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards
- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping

## Unreleased on Develop (since beta.90)

_None — beta.90 release is current._

## Follow-Up Items

- ⚡ Cache ElevenLabs model list for autocomplete (in BACKLOG Inbox)
- 🏗️ Rate limit `/voice-references/:slug` (in BACKLOG Inbox)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
