# Current

> **Session**: 2026-03-09
> **Version**: v3.0.0-beta.89

---

## Session Goal

_ElevenLabs BYOK implementation (Voice Engine Phase 4) — premium STT/TTS for users with their own API key._

## Active Task

PR #727 open for review: https://github.com/lbds137/tzurot/pull/727

---

## Completed This Session

- **feat(common-types)**: Add `AIProvider.ElevenLabs` enum, `ELEVENLABS_BASE_URL`, Discord provider choice
- **feat(ai-worker)**: ElevenLabs client (`ElevenLabsClient.ts`) — stateless API functions for TTS, STT, voice cloning, listing, deletion
- **feat(ai-worker)**: ElevenLabs voice service (`ElevenLabsVoiceService.ts`) — auto-clone voices with TTLCache, negative cache, in-flight dedup
- **feat(ai-worker)**: Auth resolution for ElevenLabs BYOK key (independent from OpenRouter, skipped in guest mode)
- **feat(ai-worker)**: TTS routing — ElevenLabs BYOK priority over self-hosted voice-engine
- **feat(ai-worker)**: STT routing — ElevenLabs → voice-engine → Whisper fallback chain
- **feat(bot-client)**: Content type threading (MP3 vs WAV → correct Discord file extension)
- **chore**: Exhaustive switch cascade updates across 7 files for new `AIProvider.ElevenLabs`
- **test**: 37 new tests across ElevenLabsClient, ElevenLabsVoiceService, AuthStep, TTSStep, AudioProcessor, DiscordResponseSender

## Previous Session

- **release**: v3.0.0-beta.89 merged to main and deployed (102 commits, 193 files)
- **fix(voice-engine)**: Address 3 rounds of PR #714 review feedback + Python test coverage (~68% → ~80%)
- **docs**: Long-lived branch protection rules (near-miss: almost deleted `develop`)

## Post-Deploy Checklist (from v3.0.0-beta.89)

- [x] Merge PR #714 to main
- [x] Create release tag + GitHub release notes
- [x] DB migration applied to prod
- [ ] Run `/admin db-sync` in Discord to sync voice references to prod
- [ ] Smoke test voice commands in production

## Recent Releases

- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards
- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping

## Follow-Up Items

- Thread ElevenLabs key through `AudioTranscriptionJob` for full STT coverage (v1 only covers inline transcription)
- Voice slot management UX (backlog item — `/settings apikey voices`)
- Log warning on `voiceReferenceType` WAV fallback
- Comment on `shouldRunTTS` default
- Expand `mypy --strict` to test files
- Clean up completed voice-engine proposal doc

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
