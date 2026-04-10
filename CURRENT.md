# Current

> **Session**: 2026-04-10
> **Version**: v3.0.0-beta.94

---

## Session Goal

_Browse Standardization Step 8: Footer helper module + migration of all 11 browse commands._

## Active Task

Browse footer standardization complete (PR #776 merged). Ready to cut beta.93 release.

---

## Completed This Session

### PR #776 — Browse Footer Standardization (CPD 137→126)

- **New module**: `footer.ts` — composable helpers: `joinFooter`, `pluralize`, `formatFilterLabeled`, `formatFilterParens`, `formatSortNatural`, `formatSortVerbatim`, `formatPageIndicator`
- **Migrated all 11 browse commands** to use shared helpers
- **Two cosmetic fixes**: delimiter `·` → `•` in inspect + shapes; singular-aware pluralization
- **Deny test mock** upgraded with `importOriginal` pattern
- **3 review rounds addressed**: renamed `formatSortHardcoded` → `formatSortVerbatim`, narrowed `joinFooter` type to exclude `number`/`true`, extracted `footer.test.ts`, fixed deny footer UX regression, consolidated shapes imports

### CPD Progress

- **Before**: 137 clones
- **After**: 126 clones (-11)
- **Target**: <100

---

## Unreleased on Develop (since beta.92)

### Browse Standardization Epic (Steps 1-8)

| PR   | Type     | Summary                                                                               |
| ---- | -------- | ------------------------------------------------------------------------------------- |
| #771 | refactor | Memory browse/search migration to router pattern (15 review rounds)                   |
| #772 | refactor | `buildBrowseSelectMenu` factory (Step 4)                                              |
| #773 | refactor | admin/servers customId migration + `TSort` generic (Step 5)                           |
| #775 | refactor | `buildBrowseButtons` TSort generic + discriminated `ParsedBrowseCustomId` (Steps 6-7) |
| #776 | refactor | Browse footer helpers — composable footer module + all 11 command migrations (Step 8) |

### Architecture & Code Quality

| PR/Commit | Type     | Summary                                                            |
| --------- | -------- | ------------------------------------------------------------------ |
| #766      | refactor | Shared abstractions (shapes error, personality fields, net errors) |
| #768      | chore    | Knip cleanup (dead exports, stale deps, config)                    |
| #769      | refactor | Config override helpers (tryInvalidateCache, mergeAndValidate)     |

### Bug Fixes & Security

| PR/Commit | Type | Summary                                                  |
| --------- | ---- | -------------------------------------------------------- |
| #759      | fix  | Voice engine ECONNREFUSED retry resilience (TTS + STT)   |
| #760      | fix  | Security dep bumps (undici, path-to-regexp) + CodeQL fix |
| direct    | fix  | ConfigStep: pass channelId to cascade resolver           |
| #764      | deps | dotenv + lru-cache bumps                                 |
| #767      | deps | turbo + dev dep bumps                                    |

---

## Previous Sessions

- **2026-04-09**: Browse Steps 6-7 (PR #775), footer design plan + council consultation
- **2026-04-06**: Architecture day (PRs #766, #768, #769), CPD 146→137
- **2026-04-05**: Voice engine retry (PR #759), security fixes (PR #760)

## Recent Releases

- **v3.0.0-beta.92** (2026-04-04) — Bundled bugfixes + voice pipeline resilience
- **v3.0.0-beta.91** (2026-03-12) — Voice pipeline hardening
- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
