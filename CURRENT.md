# Current

> **Session**: 2026-03-07
> **Version**: v3.0.0-beta.88

---

## Session Goal

_Voice Engine Phase 2: Python hardening + ai-worker integration._

## Active Task

None — session complete.

---

## Completed This Session

- **fix(api-gateway)**: Add proxy pattern comment to `hasVoiceReference` in formatters.ts
- **fix(api-gateway)**: Remove slug from 404 error message in voiceReferences.ts (information disclosure nit)
- **feat(voice-engine)**: Add `pyproject.toml` (ruff, mypy, pytest config) and `requirements-dev.txt`
- **feat(voice-engine)**: Add full type hints to `server.py` (mypy --strict compatible)
- **feat(voice-engine)**: Replace all `print()` with structured JSON logging via stdlib `logging`
- **feat(voice-engine)**: Create pytest test suite (tests/conftest.py, test_health.py, test_transcribe.py, test_tts.py, test_voices.py)
- **feat(common-types)**: Add `VOICE_ENGINE_URL` and `VOICE_ENGINE_API_KEY` to config schema
- **feat(ai-worker)**: Create `VoiceEngineClient` with health check and transcription methods
- **feat(ai-worker)**: Wire voice-engine into `AudioProcessor.ts` as primary STT path with Whisper fallback
- **docs**: Add Python standards section to `.claude/rules/02-code-standards.md`

## Recent Releases

- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping
- **v3.0.0-beta.86** (2026-03-03) — LLM response quality fixes

## Next Steps

1. Docker build + local smoke test (`podman build`, `curl /health`)
2. Deploy voice-engine to Railway, set `VOICE_ENGINE_URL` + `VOICE_ENGINE_API_KEY` on ai-worker
3. Start Voice Engine Phase 3: Bot-client TTS integration

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
