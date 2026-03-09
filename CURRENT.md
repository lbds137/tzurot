# Current

> **Session**: 2026-03-08
> **Version**: v3.0.0-beta.88

---

## Session Goal

_Voice Engine Phase 3: Merge PR #710 (TTS integration + voice config cascade)._

## Active Task

None — session complete.

---

## Completed This Session

- **feat(voice-engine)**: Phase 3 TTS integration merged to `develop` (PR #710, 19 rounds of review feedback)
  - TTSStep pipeline step: synthesize LLM response to audio, store in Redis, attach to Discord message
  - VoiceRegistrationService: 3-tier caching (positive 30min, negative 5min, in-flight dedup)
  - Chunked TTS: sentence-boundary splitting, WAV PCM concatenation for text >2000 chars
  - Config cascade: `voiceResponseMode` (always/voice-only/never) + `voiceTranscriptionEnabled`
  - Typing indicator bug fix: 8s interval refresh during voice transcription
  - Python CI: ruff + mypy --strict + pytest in GitHub Actions
  - Root logger JSON formatting for third-party libs (NeMo/uvicorn)
  - Startup health check (one-shot, non-blocking)
  - LRU eviction test, OpenAI Whisper singleton extraction

## Completed Last Session (2026-03-08)

- Voice Engine Phase 2 deployment + verification
- Confirmed Parakeet TDT transcription working end-to-end

## Recent Releases

- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping
- **v3.0.0-beta.86** (2026-03-03) — LLM response quality fixes

## Next Steps

1. Deploy Phase 3 to Railway (ai-worker, bot-client, voice-engine)
2. Configure a test personality with `voiceEnabled: true` + `voiceResponseMode: 'always'`
3. Verify end-to-end TTS flow (text → voice-engine → audio attachment in Discord)
4. Wire `voiceTranscriptionEnabled` cascade field to bot-client (Phase 3 follow-up)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
