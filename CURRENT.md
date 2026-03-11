# Current

> **Session**: 2026-03-11
> **Version**: v3.0.0-beta.90

---

## Session Goal

_Prepare beta.91 release — voice pipeline resilience (TTS retry, typed timeouts, model list caching)._

## Active Task

Backlog updated. Deciding whether to add more to the release or cut beta.91 now.

---

## Completed This Session

- **feat(ai-worker,api-gateway)**: Voice pipeline hardening (PR #733) — typed `TimeoutError` across all ai-worker timeout sites, `ElevenLabsTimeoutError extends TimeoutError`, 5-min TTLCache for ElevenLabs model list in api-gateway
- Addressed 3 rounds of PR review feedback (cache-before-DB optimization, cross-reference docs, null check confirmation)
- Backlog cleanup: marked Cache ElevenLabs model list + Audit Manual Timeout Throws as done, updated CPD count 146→145

## Unreleased on Develop (since beta.90)

| PR   | Type      | Summary                                                                           |
| ---- | --------- | --------------------------------------------------------------------------------- |
| #731 | feat/fix  | Retry transient ElevenLabs TTS errors + voice-engine TTS fallback                 |
| #732 | fix       | Typed `TimeoutError` sentinel replacing string matching in `withRetry`            |
| #733 | feat/perf | Voice pipeline hardening: remaining `TimeoutError` conversions + model list cache |

## Previous Session

- **fix(api-gateway,bot-client)**: Detect ElevenLabs scoped-key permission errors — parse `missing_permissions` status from 401 response, return descriptive error listing required permissions
- **fix(common-types,bot-client)**: Trim whitespace from API key input
- **fix(ai-worker)**: Auto-reclone ElevenLabs voice on 404 (stale cache after `/settings voices clear`) — `invalidateVoice()` + catch-retry in TTSStep
- **fix(bot-client,api-gateway,common-types)**: Pass userId to transcribe endpoint for BYOK STT key resolution — was hardcoded as 'system'

## Recent Releases

- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening: scoped-key detection, voice auto-reclone, STT userId fix, TTS model config
- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards
- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping

## Follow-Up Items

_None — release ready._

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
