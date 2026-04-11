# Current

> **Session**: 2026-04-11
> **Version**: v3.0.0-beta.94

---

## Session Goal

_CPD Zero Roadmap Session 1 — bot-client settings factory + api-gateway shared helpers + latent cap bug investigation._

## Active Task

Session 1 wrap-up: three PRs in flight (PR #778 refactor, PR #779 refactor, PR #780 wrap-up docs). PR #778 review feedback already addressed. Ready for user review + merge.

---

## Completed This Session

### PR #778 — Bot-Client Settings Command Factory + Governance Rule + Cap Bug Investigation

**Refactor**: Extracted `createSettingsCommandHandlers` factory from three entity-ID settings dashboards (`character/overrides.ts`, `character/settings.ts`, `channel/settings.ts`). Public API preserved — zero test file changes, 70 existing tests pass untouched. The plan's original "2 twin files" scope expanded to 3 after investigation found `channel/settings.ts` was the surprise third consumer with an inline closure pattern that hoisted cleanly into a shared `createUpdateHandler(channelId)`.

**Governance rule**: Added "Out-of-Scope Items Must Be Tracked" section to `.claude/rules/06-backlog.md`. Distinguishes type (a) design decisions (no tracking) from type (b) known defects (must have backlog entry). Session-end gate requires all promised backlog additions in place before closing.

**Cap bug investigation**: Root-cause investigation of `PersonalityCharacterFieldsSchema` caps leaking into data validation. DB survey found **40 of 168 personalities (23.8%) actively affected**. Silent-data-loss bug identified at `ModalFactory.ts:108` — `currentValue.slice(0, maxLength)` pre-fill truncation destroys content on save with no warning. Reference fix found in `/memory` command's `detailModals.ts:61-156` (two-flow pattern: destructive-edit warning with explicit opt-in, "View Full" button for reads). New 🚨 Production Issue entry + cross-cutting Inbox item added to `BACKLOG.md`.

**Review feedback**: Addressed null-parse test coverage gap for `handleSelectMenu` and `handleModal` (factory test: 9 → 11).

### PR #779 — API Gateway Shared Helpers (`resolveUserIdOrSendError` + `validateLlmConfigModelFields`)

Two related extractions:

- `resolveUserIdOrSendError` in `configOverrideHelpers.ts` — collapsed `getOrCreateUser + bot-null-check + error-send` pattern across **15 call sites in 9 files** (grep rule revealed nearly double the plan's original 9-site estimate; 3 shapes files unified from `'Cannot create user'` to `'Cannot create user for bot'`, minor user-facing text improvement).
- `validateLlmConfigModelFields` in new `llmConfigValidation.ts` — collapsed model-id + context-window validation across 4 call sites (admin + user llm-config, create + update), including the subtle "fetch current model as fallback when only contextWindowTokens is updated" logic.

13 new unit tests total (4 for user-resolution helper, 9 for LLM config validation). All 1703 api-gateway tests pass with zero consumer-test changes.

### PR #780 — Session 1 Wrap-Up Docs

This PR. BACKLOG.md additions for the type-(b) items the two refactor PRs flagged but didn't fix. CURRENT.md update. Roadmap recalibration in `~/.claude/plans/cpd-zero-roadmap.md`.

### CPD Progress

- **Before**: 126 clones (end of 2026-04-10 session)
- **After both PRs merge**: 118 clones (-8 total, -5 from PR #778, -3 from PR #779)
- **Target**: <100 (still 18 clones to go across Sessions 2-4)
- **Honest framing**: the original roadmap estimated ~24 clones for Session 1 based on a stale snapshot. Investigation revealed the roadmap's assumptions didn't match current code; realistic Session 1 target was 6-8. Delivered 8. Sessions 2-4 estimates need similar recalibration — flagged in roadmap update.

### Backlog Additions (Session 1 Governance Output)

Per the new out-of-scope tracking rule, these type-(b) items are now in `BACKLOG.md`:

1. 🚨 **Character field length caps cause silent data loss** (Production Issues) — from cap bug investigation, with DB survey numbers and reference fix
2. 🏗️ **Standardize over-long field handling pattern across commands** (Inbox) — cross-cutting concern, rule-of-three progression tied to the Production Issue
3. 🏗️ **Rename `channel/settings.ts` → `channel/context.ts`** (Quick Wins) — four-layer naming drift flagged during PR #778 migration
4. 🧹 **Trim 18 duplicated guard/parse tests** (Quick Wins) — post-factory-landing cleanup, deferred from PR #778
5. 🧹 **Audit Claude auto-memory vs. project rules/docs** (Inbox) — meta-level governance, draft "what belongs where" rule
6. 🧹 **Periodic audit of `scripts/` for promotion candidates** (Inbox) — meta-level governance, catch "one-offs" that secretly repeat
7. Marked stale Phase 7 entry "DRY personality create/update Zod schemas" as `[x]` done — confirmed implemented during investigation

---

## Unreleased on Develop (since beta.92)

### CPD Zero Roadmap Session 1 (2026-04-11)

| PR   | Type     | Summary                                                                                      |
| ---- | -------- | -------------------------------------------------------------------------------------------- |
| #778 | refactor | Bot-client `createSettingsCommandHandlers` factory + governance rule + cap bug investigation |
| #779 | refactor | API gateway `resolveUserIdOrSendError` + `validateLlmConfigModelFields`                      |
| #780 | docs     | Session 1 wrap-up: backlog additions + CURRENT update                                        |

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

- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126
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
