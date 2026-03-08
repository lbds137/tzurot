# Current

> **Session**: 2026-03-08
> **Version**: v3.0.0-beta.88

---

## Session Goal

_Voice Engine Phase 2: Railway deployment + verification._

## Active Task

None — session complete.

---

## Completed This Session

- **fix(voice-engine)**: Bind uvicorn to `::` (IPv6 wildcard) for Railway private networking compatibility
- **deploy**: Voice-engine service deployed to Railway (Serverless mode, 4GB RAM, volume at `/app/voices`)
- **deploy**: Set `VOICE_ENGINE_URL` + `VOICE_ENGINE_API_KEY` on ai-worker service
- **verify**: Confirmed Parakeet TDT transcription working end-to-end (Discord voice message → voice-engine → ai-worker)
- **verify**: Compared transcription quality — Parakeet TDT preserves filler words, comparable punctuation to Whisper

## Completed Last Session (2026-03-07)

- Voice Engine Phase 2 code: Python hardening, VoiceEngineClient, AudioProcessor wiring
- PR #709 merged to `develop` (21 commits, 12 rounds of review feedback addressed)
- All voice-engine follow-ups consolidated into Phase 3 pre-requisites in BACKLOG.md

## Recent Releases

- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping
- **v3.0.0-beta.86** (2026-03-03) — LLM response quality fixes

## Next Steps

1. Start Voice Engine Phase 3 pre-requisites (Python CI, root logger, startup health check, etc.)
2. Phase 3 core: Bot-client TTS integration

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
