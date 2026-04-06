# Current

> **Session**: 2026-04-06
> **Version**: v3.0.0-beta.93

---

## Session Goal

_Architecture improvement: create reusable abstractions to reduce CPD clones and improve code quality._

## Active Task

Architecture improvement day complete. All PRs merged. Ready for next session.

---

## Completed This Session

### PR #766 — Shared Abstractions (CPD 146→139)

- **Shapes Job Error Handler Factory** — `handleShapesJobError()` in `shapesJobHelpers.ts`
- **Personality Character Fields** — `PersonalityCharacterFields` interface + `PersonalityCharacterFieldsSchema` Zod fragment, single source of truth for 8 fields across 5 files
- **Transient Network Error Helper** — `isTransientNetworkError()` with recursive cause-chain checking
- Flaky test fix: ts-morph timeout 15s→30s for slow CI runners

### PR #768 — Knip Cleanup

- Removed unused root deps: `openai`, `uuid`
- Unexported 8 dead exports across 7 files
- Cleaned 7 stale knip.json ignore patterns
- Fixed pre-existing `preserve-caught-error` lint violation

### PR #769 — Config Override Helpers

- `tryInvalidateCache()` — universal cache invalidation wrapper with structured context, replacing 4 duplicated functions across 4 route files
- `mergeAndValidateOverrides()` — body validation + merge + Prisma.JsonNull conversion

### Dependabot

- PR #764 merged (dotenv + lru-cache bumps)
- PR #767 merged (turbo + dev dep bumps)
- PRs #762, #763, #765 closed (superseded/regenerated)

### CPD Progress

- **Before**: 146 clones
- **After**: 137 clones (-9)
- **Target**: <100

### Key Learnings

- API Gateway route factory approach hit diminishing returns — CPD clones in routes are small fragments, not large structural blocks. Helpers prevent future duplication but don't dramatically collapse existing clone counts.
- Memory route `resolveMemoryContext` extraction doesn't fit cleanly — each consumer handles the "no persona" case differently (404 vs empty result).
- Bot-client dashboard/browse clones (Sessions 3) are likely higher-value targets — larger structural blocks across command files.

## Strategic Plan — Next Steps

| Priority | Task                                | Est. Impact         | Est. Effort   |
| -------- | ----------------------------------- | ------------------- | ------------- |
| 1        | A2: Dashboard session/modal helpers | ~20 clone reduction | 3-4 hrs       |
| 2        | A3: Browse utility full adoption    | ~12 clone reduction | 2-3 hrs       |
| 3        | B5: Oversized file splits (6 files) | Code health         | 3-4 hrs       |
| 4        | A7: CacheWithTTL base class         | ~6 clone reduction  | 2-3 hrs       |
| 5        | B1-B4: Package extraction           | bot-client decomp   | Multi-session |

## Unreleased on Develop (since beta.92)

| Commit  | Type     | Summary                                                            |
| ------- | -------- | ------------------------------------------------------------------ |
| PR #759 | fix      | Voice engine ECONNREFUSED retry resilience (TTS + STT)             |
| PR #760 | fix      | Security dep bumps (undici, path-to-regexp) + CodeQL fix           |
| direct  | fix      | ConfigStep: pass channelId to cascade resolver                     |
| PR #766 | refactor | Shared abstractions (shapes error, personality fields, net errors) |
| PR #768 | chore    | Knip cleanup (dead exports, stale deps, config)                    |
| PR #769 | refactor | Config override helpers (tryInvalidateCache, mergeAndValidate)     |
| PR #764 | deps     | dotenv + lru-cache bumps                                           |
| PR #767 | deps     | turbo + dev dep bumps                                              |

## Previous Session

- **PR #759** (merged): Voice engine ECONNREFUSED retry resilience
- **PR #760** (merged): Security dep bumps + CodeQL fix
- Direct to develop: ConfigStep channelId fix

## Recent Releases

- **v3.0.0-beta.92** (2026-04-04) — Bundled bugfixes + voice pipeline resilience
- **v3.0.0-beta.91** (2026-03-12) — Voice pipeline hardening
- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening

## Follow-Up Items

- beta.93 release prep still pending (voice retry + security + configStep + architecture work)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
