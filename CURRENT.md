# Current

> **Session**: 2026-03-06
> **Version**: v3.0.0-beta.88

---

## Session Goal

_Voice Engine Phase 1: Python service + voice reference blob storage._

## Active Task

None — session complete.

---

## Completed This Session

- **feat(voice-engine)**: Create Python voice-engine service (`services/voice-engine/`) with Parakeet TDT STT and Pocket TTS endpoints
- **feat(prisma)**: Add `voiceReferenceData` (Bytes) and `voiceReferenceType` (VarChar) to Personality model
- **feat(common-types)**: Add `VOICE_REFERENCE_LIMITS`, `AUDIO_WAV`, `AUDIO_FLAC` constants; add `hasVoiceReference` to `PersonalityFullSchema`
- **feat(api-gateway)**: Voice reference processor, serving route (`GET /voice-references/:slug`), CRUD wiring in personality create/update
- **docs**: Fix implementation guide bugs (`.text` attribute, MIT license, espeak-ng note), add phase markers and completion status

## Recent Releases

- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping
- **v3.0.0-beta.86** (2026-03-03) — LLM response quality fixes

## Next Steps

1. Merge Phase 1 PR, deploy, run migration (`pnpm ops db:migrate --env dev`)
2. Start Voice Engine Phase 2: ai-worker VoiceService + BullMQ integration
3. Build and test Python Docker image locally (smoke tests with curl)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
