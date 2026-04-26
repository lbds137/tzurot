## 📅 Next Theme: CPD Clone Reduction

_Focus: Reduce code clones to <100. Demoted from Next Epic 2026-04-21 when TTS promoted; resume after TTS Epic completes._

**Progress**: 175 → 127 (PRs #599, #665–#668); grew to 152 from features; PR #729 → 146; 2026-04-06 architecture day (PRs #766, #768, #769) → 137; PR #776 (browse footer helpers) → 126; Session 1 (PRs #778, #779) → 118; PR #785 (ElevenLabs `readBody` extraction) → 119; 2026-04-13 quick wins session (PRs #794-798, thinking tags data-driven, BrowseActionRow extraction, routeHelpers split) → 119. **Current (`develop`): 119.** BrowseActionRow and thinking tag dedup were type/regex clones not counted by CPD; runtime code clone count unchanged.

### Completed (Phases 1-4)

Phases 1-4 shipped in PRs #599, #665-#668, #704 — Redis setup factory, error reply helpers, route test utilities, personality formatters, API gateway route boilerplate extractions. See git history for details.

### Phase 5: Bot-Client Dashboard Patterns (~16 clones)

Session/ownership boilerplate and modal/select handling repeated across all dashboard commands.

- [ ] Standardize `requireDashboardSession` utility — session lookup + expiry + ownership check (8 clones across settings, preset, persona, deny dashboards)
- [ ] Extract `handleDashboardModalSubmit` — section lookup + value extraction + API call + refresh (4 clones)
- [ ] Extract `handleDashboardSelectMenu` — edit prefix parsing + section lookup (2 clones)
- [ ] Deduplicate persona profile section config — single source of truth between `config.ts` and `profileSections.ts` (3 clones)

### Phase 6: Bot-Client Command Patterns (~15 clones)

Subcommand routing, browse/pagination, custom IDs, and command-specific duplication.

- [ ] Consolidate subcommand routers — parameterized router with context-type generic (3 clones)
- [x] Migrate browse consumers to `browse/` utilities, delete `paginationBuilder.ts` (4 clones) — PRs #771-776
- [x] Servers command: use `createBrowseCustomIdHelpers` instead of inline parsing (4 clones) — PR #773
- [ ] Extract memory command shared helpers — `formatMemoryLine` (remaining clones)

### Phase 7: Cross-Service & Common-Types (~15 clones)

Shared types, config resolver patterns, and remaining cross-service duplication.

- [x] Define `PersonalityFields` type in common-types — `PersonalityCharacterFields` interface + Zod schema fragment (4 files updated)
- [ ] Extract `CacheWithTTL` base — cleanup interval + user-prefix invalidation (6 clones across config resolvers)
- [x] DRY personality create/update Zod schemas — use `.extend()` (2 clones) — already implemented via `...PersonalityCharacterFieldsSchema.shape` composition in `PersonalityCreateSchema` and `PersonalityUpdateSchema` (confirmed during Session 1 investigation, 2026-04-11)
- [ ] Extract `sessionContextFields` Zod fragment — shared between jobs.ts and personality schemas (1 clone)
- [ ] ResultsListener: use shared `createIORedisClient` factory (1 clone)

### Phase 8: AI Worker + Tooling (~10 clones)

Smaller wins in ai-worker internal patterns and tooling utilities.

- [ ] Extract `createStuckJobCleanup(model, config)` factory (2 clones)
- [x] Extract `handleShapesJobError` shared error handler — `shapesJobHelpers.ts` factory with callbacks
- [ ] Extract tooling `spawnWithPiping` and shared `execFileSafe` helpers (3 clones)
- [ ] Extract migration preamble helper (`validateEnvironment` + banner + client) (2 clones)

### Remaining (~10 clones)

Small, localized duplication (1-2 clones each) across deny commands, shapes formatters, preset import types, autocomplete error handling, avatar file ops. Fix opportunistically.

**Target**: <100 clones or <1.5%. Currently 119 clones on develop.
