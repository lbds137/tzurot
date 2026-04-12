# Current

> **Session**: 2026-04-11
> **Version**: v3.0.0-beta.94

---

## Session Goal

_Started: CPD Zero Roadmap Session 1. Pivoted mid-session to a full documentation + Claude auto-memory audit cycle after backlog hygiene work surfaced multiple low-hanging items. Both arcs now complete._

## Active Task

**None — session complete.** Seven PRs merged (#778, #779, #780, #781, #782, #783, #784). CPD 126 → 118. ~2200 net lines of stale documentation deleted. Doc-audit skill hardened with memory section, glob fallbacks, verify-before-deleting, and diverged-planning-docs lifecycle rule. See "Completed This Session" below.

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

### PR #781 — Channel Settings Function Rename (Quick Win)

Pivot from CPD work to clearing low-hanging backlog items. Originally framed as "rename `channel/settings.ts` → `channel/context.ts`" but investigation showed the rename direction was backwards: the slash command is `/channel settings`, the file is `channel/settings.ts`, and the function names were the outliers (`handleChannelContext*`). Rename moved in the OPPOSITE direction: function names aligned to the subcommand. 7 dispatcher tests added for codecov.

### Documentation + Auto-Memory Audit Cycle (PRs #782, #783, #784)

Started as a small "memory audit + maybe docs" task, scope-expanded into a full audit cycle covering all 13 sections of the `/tzurot-doc-audit` checklist. Three PRs in dependency order:

**PR #782** — Expanded `tzurot-doc-audit` skill to cover Claude auto-memory as Section 0 (runs FIRST so layer migrations cascade into later sections). Added 5-verdict classification table (Keep / Migrate-to-rules / Migrate-to-docs / Migrate-to-skills / Delete), verify-before-deleting safeguards, classification heuristics, glob error suppression, and several rounds of polish from 7+ review iterations. The standalone "Audit Claude auto-memory" backlog item is now subsumed by the recurring audit.

**PR #783** — Output of running the new audit. Sections 0 + 1-3 + 10-13:

- **Memory audit**: 8 → 5 files. Deleted `feedback_out_of_scope_tracking.md` (already covered by `06-backlog.md` rule). Migrated `feedback_council_model_selection.md` + `mcp_council_model_drift.md` into `tzurot-council-mcp` skill (which was _also_ stale — recommending DeepSeek R1 against explicit user feedback). Migrated "Distrobox for Python" inline section to new `docs/steam-deck/VOICE_ENGINE_PYTHON.md`. Refreshed CPD project memory (126→118). MEMORY.md restructured to a pure index.
- **Rules fixes**: 03-database.md two-tier `protectedIndexes` vs `ignorePatterns` clarification + DenylistCache row. 04-discord.md added 2 missing dashboard utilities. 07-documentation.md fourth-layer auto-memory callout + removed dead `docs/proposals/active/` row. CLAUDE.md gained a 1-line entry criterion for the post-mortem table (recommended by Gemini 3.1 Pro Preview via council MCP — reframed the criterion from "recency + severity" to "AI-specific behavioral failures").

**PR #784** — Output of running sections 4-9. Mostly deletes:

- **3 deletions** (~1990 lines): `DEVELOPMENT.md` (v3-launch-era rot, redundant with root README), `SLASH_COMMAND_UX_FEATURES.md` (planning doc whose implementation moved to `/preset`), `SHAPES_INC_SLASH_COMMAND_DESIGN.md` (proposal for a fully-implemented feature with dead self-supersede references).
- **Real correctness bug**: `PRISMA_DRIFT_ISSUES.md` recovery SQL said `USING hnsw` but the actual index is IVFFlat — silent footgun if anyone copy-pasted. Fixed.
- **Dead-directory references**: removed `docs/migration/` and `docs/testing/` from the rules placement table and skill checklist (same dead-directory pattern as `docs/proposals/active/`).
- **New lifecycle rule**: "Diverged planning docs" — covers the archetype that produced both `DEVELOPMENT.md` and `SLASH_COMMAND_UX_FEATURES.md`. The existing 4 categories (completed proposals, raw transcripts, abandoned plans, build process docs) had a gap for "we built _something_, but the thing we built isn't what the doc described." Added a one-line bullet to `07-documentation.md` and a full paragraph to `DOCUMENTATION_PHILOSOPHY.md`.

**Cumulative audit impact**: ~25:1 deletion-to-insertion ratio across the 3 PRs. The doc-audit skill's own outputs (rules + skill improvements) materially raised the floor on each subsequent review round — PR #784 reached "approved as-is" with minimal iteration.

### Backlog Additions (Session 1 Governance Output)

Per the new out-of-scope tracking rule, these type-(b) items were added to `BACKLOG.md`. Status updated at session end:

1. 🚨 **Character field length caps cause silent data loss** (Production Issues) — still open, with DB survey numbers and reference fix documented
2. 🏗️ **Standardize over-long field handling pattern across commands** (Inbox) — still open, cross-cutting concern
3. ✅ **Rename `channel/settings.ts` → `channel/context.ts`** (Quick Wins) — **DONE in PR #781**, but with the rename direction inverted: function names aligned to the existing `settings` subcommand instead of the file being renamed to match the function names
4. 🧹 **Trim 18 duplicated guard/parse tests** (Quick Wins) — still open, post-factory-landing cleanup
5. ✅ **Audit Claude auto-memory vs. project rules/docs** (Inbox) — **DONE via PRs #782/#783** — fully subsumed by the recurring `/tzurot-doc-audit` skill (Section 0). Removed from BACKLOG.
6. 🧹 **Periodic audit of `scripts/` for promotion candidates** (Inbox) — still open
7. Marked stale Phase 7 entry "DRY personality create/update Zod schemas" as `[x]` done — confirmed implemented during investigation

---

## Unreleased on Develop (since beta.92)

### CPD Zero Roadmap Session 1 (2026-04-11)

| PR   | Type     | Summary                                                                                      |
| ---- | -------- | -------------------------------------------------------------------------------------------- |
| #778 | refactor | Bot-client `createSettingsCommandHandlers` factory + governance rule + cap bug investigation |
| #779 | refactor | API gateway `resolveUserIdOrSendError` + `validateLlmConfigModelFields`                      |
| #780 | docs     | Session 1 wrap-up: backlog additions + CURRENT update                                        |

### Quick Win + Documentation Audit Cycle (2026-04-11, same day)

| PR   | Type     | Summary                                                                                                                  |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| #781 | refactor | Channel command function rename (align to subcommand instead of renaming the file)                                       |
| #782 | docs     | Expand `tzurot-doc-audit` skill to cover Claude auto-memory (Section 0, runs first)                                      |
| #783 | docs     | Audit output: memory cleanup (8→5 files), rules/skill refresh, post-mortem entry criterion (council-recommended)         |
| #784 | docs     | Audit output: 3 deletions of rotted docs (~1990 lines), IVFFlat correctness fix, "Diverged planning docs" lifecycle rule |

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
