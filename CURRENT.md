# Current

> **Session**: 2026-04-05
> **Version**: v3.0.0-beta.92

---

## Session Goal

_Post-release bug fixes and security maintenance._

## Active Task

Session bug fixes complete. Ready for backlog triage or next task.

---

## Completed This Session

- **PR #759** (merged): Voice engine ECONNREFUSED retry resilience — `isTransientVoiceEngineError` classifier + `withRetry` wrappers for both TTS and STT paths, mirroring ElevenLabs retry pattern
- **PR #760** (merged): Security dep bumps (undici 6.24.1, path-to-regexp 8.4.2) + CodeQL voice-engine path traversal fix
- **Direct to develop**: Fix ConfigStep missing `channelId` — ai-worker was ignoring ALL per-channel config overrides (maxAge, voiceResponseMode, etc.)

## Unreleased on Develop (since beta.92)

| Commit  | Type | Summary                                                                            |
| ------- | ---- | ---------------------------------------------------------------------------------- |
| PR #759 | fix  | Voice engine ECONNREFUSED retry resilience (TTS + STT)                             |
| PR #760 | fix  | Security dep bumps (undici, path-to-regexp) + CodeQL fix                           |
| direct  | fix  | ConfigStep: pass channelId to cascade resolver (per-channel overrides were broken) |

## Previous Session

- **PR #756**: Bundled bugfixes (tag leaks, vision model, context window, mp4, self-transcription)
- **PR #757**: Voice pipeline resilience for cold starts
- Shipped v3.0.0-beta.92

## Recent Releases

- **v3.0.0-beta.92** (2026-04-04) — Bundled bugfixes + voice pipeline resilience
- **v3.0.0-beta.91** (2026-03-12) — Voice pipeline hardening
- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening

## Follow-Up Items

- LLM duplicate/looping response detection — screenshot from GLM-5 showing repeated content blocks (backlog item)
- Post-processing architecture review — tag stripping + output massaging has grown organically
- Channel maxAge: bot-client path was already wired correctly, the ConfigStep fix should resolve the issue. Verify after deploy.
- Architecture review + documentation freshness check

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
