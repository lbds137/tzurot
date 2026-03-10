# Current

> **Session**: 2026-03-10
> **Version**: v3.0.0-beta.89

---

## Session Goal

_Phase 4.6 shipped. Dev testing before beta.90 release._

## Active Task

Phase 4.6 merged (PR #729). Documentation updated. Next: deploy to dev and test changes before production release.

---

## Completed This Session

- **feat(ai-worker,api-gateway,bot-client)**: Configurable ElevenLabs TTS model — config cascade, `/settings voices model` with autocomplete, `elevenLabsListModels`, TTSStep wiring
- **refactor(ai-worker,api-gateway,bot-client)**: CPD reduction — `voiceReferenceHelper.ts`, `elevenLabsFetch.ts`, `storeTTSResult`, audio extraction reuse, `fetchEditableCharacter` (152→146 clones, -124 lines)
- **fix(api-gateway)**: WAV fallback warning log on voice reference MIME type
- **chore(ci)**: `mypy --strict` extended to voice-engine tests
- **docs**: Deleted completed 1694-line voice-engine proposal doc
- **docs**: Updated BACKLOG.md (Phase 4.6 checked off, CPD count, broken refs fixed), research doc, CURRENT.md

## Previous Session

- **chore**: Inventory of Voice Engine epic phases — confirmed Phases 1–4.5 fully shipped
- **chore**: Updated CURRENT.md and BACKLOG.md to reflect current state

## Recent Releases

- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards
- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping

## Unreleased on Develop (since beta.89)

67 commits across 3 PRs:

| PR   | Scope     | Summary                                                                                                            |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| #727 | Phase 4   | ElevenLabs BYOK — TTS/STT routing, ElevenLabsClient, ElevenLabsVoiceService, voice clone service                   |
| #728 | Phase 4.5 | BYOK hardening — thread API key through all STT callers, Whisper removal, `/settings voices browse\|delete\|clear` |
| #729 | Phase 4.6 | Configurable TTS model, WAV fallback warning, mypy tests, proposal deletion, CPD reduction                         |
| deps | —         | @types/node bumps, production deps group update, actions/setup-python v6                                           |

## Follow-Up Items

- ⚡ Cache ElevenLabs model list for autocomplete (in BACKLOG Inbox)
- 🏗️ Rate limit `/voice-references/:slug` (in BACKLOG Inbox)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
