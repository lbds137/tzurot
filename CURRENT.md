# Current

> **Session**: 2026-04-06
> **Version**: v3.0.0-beta.93

---

## Session Goal

_Architecture improvement: create reusable abstractions to reduce CPD clones and improve code quality._

## Active Task

Session 1 of strategic architecture improvement plan complete. Ready for commit or next session.

---

## Completed This Session

### A5: Shapes Job Error Handler Factory (-2 clones)

- Extracted `handleShapesJobError()` factory to `shapesJobHelpers.ts`
- Both `ShapesExportJob` and `ShapesImportJob` now use shared error handler
- Callbacks for divergent parts (DB update, result shape) instead of class hierarchy
- New test file: `shapesJobHelpers.test.ts` (7 tests)

### A4: Personality Character Fields Config (-3 clones)

- Created `PersonalityCharacterFields` interface in `common-types/schemas/api/personality.ts`
- Created `PersonalityCharacterFieldsSchema` Zod fragment, shared by create/update schemas
- Updated 4 interfaces across 3 services to extend the shared type:
  - `DatabasePersonality` (common-types)
  - `PersonalityResponse` (api-gateway)
  - `CharacterData` (bot-client)
  - `MappedPersonality` (ai-worker)

### A6: Transient Network Error Helper (-2 clones)

- Created `isTransientNetworkError()` in `common-types/constants/error.ts`
- Uses existing `TransientErrorCode` enum + `TRANSIENT_NETWORK_CODES` set
- Recursive cause-chain checking, handles plain object causes
- Updated 4 consumers:
  - `TTSStep.ts` — `isTransientElevenLabsError()` now delegates network check
  - `AudioProcessor.ts` — same pattern
  - `VoiceEngineClient.ts` — `isTransientVoiceEngineError()` delegates
  - `VoiceRegistrationService.ts` — replaced `isConnectionError()` + `CONNECTION_ERROR_CODES`
- 13 new tests in `error.test.ts`

### CPD Progress

- **Before**: 146 clones
- **After**: 139 clones (-7)
- **Target**: <100

## Strategic Plan

Full plan at `.claude/plans/soft-hatching-lerdorf.md`. Foundation First approach:

- **Session 1** (TODAY): A5 + A4 + A6 = quick abstraction wins (DONE)
- **Session 2**: A1 (API Gateway Route Factories, ~40 clone reduction) + knip cleanup
- **Session 3**: A2 + A3 (Dashboard + Browse consolidation)
- **Session 4**: B5 (Oversized file splits) + A7 (CacheWithTTL base)
- **Session 5+**: Package extraction (dashboard, browse, autocomplete)

## Unreleased on Develop (since beta.92)

| Commit  | Type | Summary                                                                               |
| ------- | ---- | ------------------------------------------------------------------------------------- |
| PR #759 | fix  | Voice engine ECONNREFUSED retry resilience (TTS + STT)                                |
| PR #760 | fix  | Security dep bumps (undici, path-to-regexp) + CodeQL fix                              |
| direct  | fix  | ConfigStep: pass channelId to cascade resolver (per-channel overrides were broken)    |
| pending | lift | A5+A4+A6: Shapes job error factory, personality fields config, transient error helper |

## Previous Session

- **PR #759** (merged): Voice engine ECONNREFUSED retry resilience
- **PR #760** (merged): Security dep bumps + CodeQL fix
- Direct to develop: ConfigStep channelId fix

## Recent Releases

- **v3.0.0-beta.92** (2026-04-04) — Bundled bugfixes + voice pipeline resilience
- **v3.0.0-beta.91** (2026-03-12) — Voice pipeline hardening
- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening

## Follow-Up Items

- Architecture review plan continues in next session (Route Factories = biggest single win)
- beta.93 release prep still pending (voice retry + security + configStep)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
