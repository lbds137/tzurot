# Current

> **Session**: 2026-03-10
> **Version**: v3.0.0-beta.89

---

## Session Goal

_Phase 4.6 cleanup + beta.90 release prep. Ship by EOD Tuesday (surgery Thursday)._

## Active Task

Inventory complete. Phase 4.6 defined — small chores rolled in alongside configurable TTS model.

---

## Completed This Session

- **chore**: Inventory of Voice Engine epic phases — confirmed Phases 1–4.5 fully shipped
- **chore**: Updated CURRENT.md and BACKLOG.md to reflect current state

## Previous Session

- **feat(ai-worker)**: Shared voice engine cold-start warm-up (`voiceEngineWarmup.ts`)
- **feat(ai-worker,api-gateway,bot-client)**: 19 rounds of PR #728 review feedback
- **refactor(ai-worker)**: Remove OpenAI Whisper STT fallback (two-tier: ElevenLabs → voice-engine)
- **feat(bot-client)**: `/settings voices browse|delete|clear` commands
- **feat(api-gateway)**: Voice management routes + Zod validation at ElevenLabs boundary
- PR #728 merged to develop

## Recent Releases

- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards
- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping

## Follow-Up Items

_All rolled into Phase 4.6 in BACKLOG.md._

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
