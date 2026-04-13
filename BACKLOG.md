# Backlog

> **Last Updated**: 2026-04-13
> **Version**: v3.0.0-beta.95

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

- 🐛 `[FIX]` **Character field length caps cause silent data loss in dashboard edit + block API updates** — `PersonalityCharacterFieldsSchema` enforces length caps (1000/100/4000 chars per field, matching Discord modal input limits) at the Zod validation layer. Characters with legacy fields exceeding those caps (likely from shapes.inc imports or pre-cap data) exhibit two failure modes:

  **1. Silent data loss via dashboard edit** (CRITICAL): When a user clicks a character dashboard section that contains an over-long field (e.g., Biography → Appearance), `ModalFactory.buildSectionModal` silently truncates the pre-fill to `maxLength` chars at `services/bot-client/src/utils/dashboard/ModalFactory.ts:108` (`currentValue.slice(0, maxLength)`). The user sees no warning. If they submit, the trailing content is irrecoverably lost. The truncation is justified at line 107 as "Discord modals require value to be within length constraints" — a genuine API constraint — but the destructive behavior is hidden from the user.

  **2. Blocked API writes when body carries over-long fields**: `PersonalityUpdateSchema` composes `...PersonalityCharacterFieldsSchema.shape`, so any PATCH body containing an over-long field fails `safeParse` at `services/api-gateway/src/routes/admin/updatePersonality.ts:123`. The error reaches the client as `"personalityAppearance: String must contain at most 4000 character(s)"` via `sendZodError`. Whether an unchanged over-long field blocks unrelated edits depends on whether the dashboard sends partial bodies (only changed fields — safe) or full snapshots (unsafe) — the dashboard flow uses section-level modals with `extractModalValues` returning only fields in the submitted modal, which suggests partial-per-section, but needs confirmation.

  **DB survey** (Railway dev, 2026-04-11, script preserved in git history at commit `1de7f127` — deleted from working tree post-review per prod-safety concern: read-only script in `scripts/` was reachable from `pnpm ops run --env prod` and could be re-run against prod without review; results captured here are authoritative):
  - **168 total personalities**; **40 (23.8%) have at least one over-cap field** — roughly 1 in 4 characters is actively affected
  - `characterInfo` (cap 4000): **27 over-cap**, max 6082 chars (52% over cap), avg 2821. Required field, affects 16.1% of characters.
  - `conversationalExamples` (cap 4000): **18 over-cap**, max 7479 chars (87% over cap), avg 2589. 11.3% affected.
  - `personalityAge` (cap 100): **5 over-cap**, max 236 chars. The 100-char cap is clearly miscalibrated — users write prose like "late 20s but claims to be 300 due to fae heritage" that doesn't fit. 3.0% affected.
  - `personalityTraits` (cap 1000): **1 over-cap**, max 1172 chars. 0.6% affected.
  - Near-cap but not over: `personalityLikes` max 3915 (98% of cap), `conversationalGoals` max 3869 (97%), `personalityDislikes` max 3732 (93%). Users are actively writing up against the wall; these will flip over when caps are relaxed or content grows.
  - All-clear: `personalityTone` (max 875 / cap 1000), `personalityAppearance` (max 3480 / cap 4000), `errorMessage` (max 938 / cap 1000)

  **Severity reframe**: this is not a latent "edge case with legacy data" — 1 in 4 characters is affected today, with the worst offenders being the two long-form narrative fields (`characterInfo` and `conversationalExamples`) where users invest the most prompt-engineering effort. These are exactly the characters people are most likely to edit and most likely to lose work on.

  **Reference fix — prior art in `/memory` command**: The memory command already solves this elegantly for its own over-long content case (`services/bot-client/src/commands/memory/detailModals.ts` lines 61–156). Pattern has two complementary flows:
  - **Edit path** (`detailModals.ts:95-130`): detect over-long content before opening modal; show `buildTruncationWarningEmbed` (lines 61–75) with exact char count, destructive-action disclaimer, 200-char preview, and explicit `"Edit with Truncation"` opt-in button; only on opt-in does `handleEditTruncatedButton` (lines 132–156) run with the truncated content reaching the modal.
  - **Display path** (`detail.ts:85-155`): `buildDetailEmbed` returns `{ embed, isTruncated }`; when truncated, adds a `"View Full"` button that renders the complete content via a non-modal path, so users can still _read_ over-long content without losing data.

  **Proposed fix**: Port the memory pattern to the character edit dashboard.
  - Detect per-section whether any field exceeds its cap before opening the section modal
  - Show a `buildCharacterTruncationWarningEmbed`-equivalent with clear destructive-action warning
  - Only open the section modal on explicit user opt-in
  - Add a "View Full" affordance to the character dashboard for reading over-long legacy field values without triggering the destructive edit path

  **Architectural complication**: Memory uses hand-rolled detail modal flow (`detailModals.ts`), while character uses the generic `ModalFactory`/`DashboardBuilder` abstraction — the ports have different plumbing. Two migration strategies:
  - **(a) Port-in-place**: copy the memory pattern into character-specific handlers. Fast, but creates a second implementation of the same pattern.
  - **(b) Shared-utility extraction**: generalize memory's pattern into a `utils/dashboard/overLongFieldWarning.ts` helper that both commands use. Slower, but is the cleaner long-term direction and closes out the cross-cutting concern tracked in the Inbox item "standardize over-long field handling pattern."

  The rule-of-three trigger suggests _port-in-place first, then extract shared utility when a third consumer appears_. But if a third consumer is genuinely likely (e.g., persona character fields eventually develop similar issues), doing (b) directly may be worth it.

  **Out of scope for CPD Session 1** (2026-04-11): This fix is its own focused PR where the reviewer can compare the memory implementation to the character implementation directly. Investigation track for Session 1 produced this entry; the fix executes in a follow-up session.

  **Start**:
  - Reference pattern: `services/bot-client/src/commands/memory/detailModals.ts:61-156`, `memory/detail.ts:85-155`
  - Silent-truncate site: `services/bot-client/src/utils/dashboard/ModalFactory.ts:108`
  - Target for detection logic: `services/bot-client/src/commands/character/sections.ts` (per-section field arrays) + wherever the section-modal button handler lives in `utils/dashboard/`
  - Caps themselves: `packages/common-types/src/schemas/api/personality.ts:159-168` — consider whether these should stay as write-validation or move to display-only markers
  - Update-path Zod entry: `services/api-gateway/src/routes/admin/updatePersonality.ts:123`
  - Related cross-cutting item: see Inbox "Standardize over-long field handling pattern across commands"

  **Severity rationale for Production Issues placement**: the silent data loss is a real destructive-on-save bug affecting an unknown number of real users, and users have no affordance to detect it before save. This is strictly worse than "can't update" — which itself is a UX bug — because at least "can't update" fails loudly.

---

## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

- 🐛 `[FIX]` **Voice engine (Pocket TTS) still fails intermittently in production** — Even after beta.95 cold start hardening and ElevenLabs abort fix, voice generation sometimes fails. This is the Pocket TTS engine specifically, not ElevenLabs. Needs investigation of Railway logs to identify the failure mode (OOM, model crash, timeout, etc.). May be further motivation for the Chatterbox Turbo TTS upgrade in Current Focus. **Start**: check Railway voice-engine logs for recent failures, `services/voice-engine/server.py`.
- 🐛 `[FIX]` **AI occasionally hallucinating response footer, causing duplication** — Rarely, models (observed with `z-ai/glm-4.5-air:free`) hallucinate the "Model: ... / FREE Using free model" footer text into their response content, which then gets the real footer appended on top — resulting in doubled footer lines. Very rare but user-visible. Investigate whether post-processing already strips known footer patterns; if not, add a cleanup step in `ResponsePostProcessor` or the response sender that detects and removes hallucinated footer content before the real footer is appended. Related: the LLM duplicate/looping response detection item may share post-processing infrastructure. **Start**: grep for footer-appending logic (likely in bot-client response sender or ai-worker post-processor), check if any existing stripping handles this pattern.
- 🐛 `[FIX]` **Periods break @ mention matching** — Personality names containing `.` (e.g., "Dr. Smith") fail to match because the period is ambiguous between abbreviation marker and sentence boundary. Apostrophes were fixed in PR #797 (O'Reilly, possessives). The period case needs a two-pass approach: try with punctuation first, strip only on no match. **Start**: `services/bot-client/src/utils/personalityMentionParser.ts` (single-word regex line ~242, multi-word per-word strip line ~228).
- 🐛 `[FIX]` **LLM duplicate/looping response detection** — GLM-5 observed producing responses with repeated content blocks (same paragraphs appearing twice within one message). Post-processing should detect and deduplicate repeated paragraph-level blocks. Observed 2026-04-05 with `z-ai/glm-5`. **Start**: `services/ai-worker/src/services/ResponsePostProcessor.ts` — add a deduplication step; `services/ai-worker/src/utils/responseArtifacts.ts` — may fit alongside existing cleanup patterns.
- 🏗️ `[LIFT]` **Rate limit `/voice-references/:slug`** — Unauthenticated endpoint serving binary audio from DB. Low urgency (Railway private networking limits exposure).
- 🏗️ `[LIFT]` **Dynamic free model selection from OpenRouter** — Replace hardcoded `FREE_MODELS` / `VISION_FALLBACK_FREE` with a query layer on `OpenRouterModelCache`. Models go stale when sunset. **Start**: `services/api-gateway/src/services/OpenRouterModelCache.ts`.
- ✨ `[FEAT]` **Config cascade extension — server, user-server, user-channel tiers** — Current cascade: admin < personality < channel < user-default < user+personality. Missing tiers: server-level defaults (server admins), user-channel (per-user per-channel, e.g., "1 week maxAge globally but off in #general"). User-default overriding channel is by design but limits power-user flexibility. Significant refactor. Related to Model Configuration Overhaul theme.
- ✨ `[FEAT]` **Cross-channel history — smarter retrieval with limits** — Limit messages per channel, prioritize channels with active conversations.
- ✨ `[FEAT]` **Inspect command privacy toggle** — Per-personality toggle to hide character card details from `/inspect`.
- ✨ `[FEAT]` **Character import — optional voice file support** — Accept optional voice reference audio alongside character data import.
- 🐛 `[FIX]` **Preset save errors are opaque — context-too-large surfaces as "failed to save"** — When a vendor restricts context on an existing model (e.g., z.ai dropping GLM context limits when releasing newer models — observed dropping to 40k–80k), editing an existing preset whose `maxContextTokens` was set to the old higher value fails with a generic "failed to save" message. User has to read Railway logs to discover the real cause. The vendor's 4xx error needs to be parsed and surfaced to the user with actionable wording (e.g., "This model's context limit is now N tokens — please reduce maxContextTokens before saving"). **Start**: preset save endpoint in `api-gateway` (search for the route handler); upstream LLM provider error mapping needs context-limit detection. Likely a missed branch in the existing error-to-user-message translation.
- 🐛 `[FIX]` **Preset clone fails on name collision instead of auto-numbering** — Cloning a preset that's already a copy fails with "a copy already exists." Other clone flows in the codebase appear to handle this by auto-numbering (e.g., "Foo (2)", "Foo (3)") but presets don't. Should be standardized — every clone button should resolve name collisions the same way. **Start**: grep for clone/copy handlers in `services/bot-client/src/commands/{personality,character,persona,preset}/` — find the existing auto-number pattern (if any) and either reuse or extract into a shared helper. If no existing pattern: create one and apply to all clone flows. Related: consider whether this also surfaces clone affordances inconsistently across commands.
- 🏗️ `[LIFT]` **Standardize over-long field handling pattern across commands** — The `/memory` command has a well-designed two-flow pattern for handling content exceeding Discord modal input limits: detection + destructive-action warning + explicit opt-in for edits (`detailModals.ts:61-156`), and a `"View Full"` affordance for reads that renders content without modal constraints (`detail.ts:85-155`). The character edit dashboard is known to have the same class of bug (see 🚨 Production Issue "Character field length caps cause silent data loss...") but currently lacks any warning — `ModalFactory.buildSectionModal` silently truncates via `slice(0, maxLength)`. Other commands with similar potential (personas with long descriptions, presets with long system prompts, etc.) may also be affected but haven't been audited. **Action**: (1) Fix character first as its own PR using memory's pattern directly (reference fix in the Production Issue entry). (2) When a second or third consumer needs the same behavior, extract the pattern into `services/bot-client/src/utils/dashboard/overLongFieldWarning.ts` as a shared utility and migrate memory + character to use it (rule of three). (3) Audit other commands for silent truncation patterns that should also use it. **Start**: `services/bot-client/src/commands/memory/detailModals.ts:61-156` (reference implementation); `services/bot-client/src/commands/{persona,preset,character}/` for additional audit targets; grep for `slice(0, maxLength)` and `setValue` across bot-client commands to find silent-truncate sites.
- 🧹 `[CHORE]` **Add `pnpm ops release:verify-notes` command** — Compares proposed release notes against `git log v<previous-tag>..HEAD --no-merges` to catch duplicate/missing items. The beta.94 release had 4 items duplicated from beta.93 because notes were written from CURRENT.md (session tracker) instead of the actual tag diff. The git-workflow skill now documents the correct process, but a tooling command would enforce it mechanically. **Start**: `packages/tooling/src/commands/release.ts` — add a `verify-notes` subcommand that parses release notes markdown, extracts PR numbers, and cross-checks against the commit range.
- 🧹 `[CHORE]` **Periodic audit of `scripts/` for patterns to promote to `packages/tooling/`** — `scripts/` is documented as a home for one-off data migration / codegen / investigation scripts that run once and are deleted. But over time the category accretes permanent-ish files (current subdirectories: `analysis/`, `data/`, `debug/`, `deployment/`, `migrations/`, `testing/`, `src/db/`, etc.) that suggest some "one-offs" actually repeat. When a pattern has 3+ sibling scripts, it's graduated past "one-off" and should become a `pnpm ops` command with structured options, tests, and doc. Audit rule: when adding a new `scripts/` file, check `scripts/` for sibling files with similar shape; if 3+ exist, promote. Schedule a quarterly audit to catch accreted patterns. The driving example is the DB-survey script added in PR #778's investigation — if a second DB-survey script appears in the next few sessions, it's a clear promotion candidate. Also consider adding this check as a rule in `05-tooling.md`. **Start**: `find scripts/ -name '*.ts'` (NOT `ls scripts/src/**/*.ts` — most existing script subdirectories like `analysis/`, `data/`, `debug/`, `deployment/`, `migrations/`, `testing/` are direct children of `scripts/`, not under `scripts/src/`) to enumerate, group by shape, identify 3+ sibling clusters as promotion candidates.

## 🎯 Current Focus

_This week's active work. Max 3 items._

- ✨ `[FEAT]` **TTS engine upgrade — replace Pocket TTS + add cheaper BYOK alternative** — Current pain: ElevenLabs v3 costs ~$200/month, Pocket TTS quality is inadequate for users. Research (2026-04-12) identified two top candidates:

  **Self-hosted (replace Pocket TTS):**
  - **Chatterbox Turbo** (350M, Resemble AI, MIT) — beats ElevenLabs in 63.75% of blind tests, has native zero-shot voice cloning + emotion control, explicit CPU Docker support, OpenAI-compatible API servers exist. Primary candidate.
  - **Kokoro 82M** (Apache) — #1 TTS Arena, tiny and CPU-optimized, but **no native voice cloning** (needs third-party KokoClone addon). Backup if Chatterbox is too heavy for Railway 4GB.

  **Paid API (cheaper BYOK alternative to ElevenLabs):**
  - **Voxtral API** (Mistral, $16/1M chars vs ElevenLabs ~$60) — 73% cheaper, wins 68% vs EL Flash in human prefs, zero-shot cloning from 3s audio. Open-weight model available as self-host fallback.
  - **Fish Audio** ($15/1M chars) — #1 TTS-Arena, 75% cheaper than ElevenLabs.

  **Next steps:**
  1. Spin up Chatterbox Turbo in a test container (Railway dev or local)
  2. Feed it a character reference audio, compare output vs Pocket TTS vs ElevenLabs
  3. If quality is good, plan the voice-engine integration (swap TTS backend, keep STT as-is)
  4. Evaluate Voxtral API as a BYOK option alongside or replacing ElevenLabs

  **Start**: `services/voice-engine/server.py` (current Pocket TTS integration), Chatterbox Docker: `docker compose -f docker/docker-compose.cpu.yml up -d` from [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server). Research links saved in Claude auto-memory (`project_voice_tts_research.md`).

---

## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

- 🐛 `[FIX]` **`updateGlobalPreset` can surface raw HTML error pages to admin users** — `api.ts:116` uses `response.text()` directly when building the error message for global preset updates. If the admin endpoint returns an HTML error page (Railway 502, Nginx error), `extractApiErrorMessage` would capture and display garbled HTML. The user/non-global path uses typed JSON `result.error`, which is clean. Fix: try parsing as JSON first, fall back to raw text only if it's a valid string. Admin-only blast radius. **Start**: `services/bot-client/src/commands/preset/api.ts` (updateGlobalPreset function).
- 🐛 `[FIX]` **Preset create 409 check uses `includes('409')` — could over-match** — `create.ts:136` checks `error.message.includes('409')` to detect duplicate name errors. An error message containing "409" elsewhere (e.g., a request ID) would incorrectly trigger the 409 branch. Fix: use `/ 409 /.test(error.message)` or match the structured format `error.message.startsWith('Failed to create preset: 409 ')`. Pre-existing, flagged during PR #799 review. **Start**: `services/bot-client/src/commands/preset/create.ts:136`.
- 🐛 `[FIX]` **Flaky xray analyzer test — "should include suppressions in file data" times out in CI** — `packages/tooling/src/xray/analyzer.test.ts:182` timed out at 15s on CI runner (observed 2026-04-13, run #24367518180). The test calls `analyzeMonorepo` which initializes a `ts-morph` Project — CPU-intensive on resource-constrained CI runners. May have worsened with `ts-morph` 27→28. Fix options: (a) increase timeout for this specific test, (b) mock `ts-morph` Project creation, (c) split suppression parsing from full analysis so it can be tested without the expensive Project init. **Start**: `packages/tooling/src/xray/analyzer.test.ts:182`, `packages/tooling/src/xray/analyzer.ts` (analyzeMonorepo function).
- 🧹 `[CHORE]` **Investigate `pnpm/action-setup` v5 → v6 upgrade** — Reverted in PR #798 due to `ERR_PNPM_BROKEN_LOCKFILE` in CI despite the lockfile being valid locally with `--frozen-lockfile`. v6 may require a different lockfile format or settings. **Start**: check pnpm/action-setup v6 changelog for breaking changes, test in an isolated branch.

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.

---

## 🏗 Active Epic: CPD Clone Reduction

_Focus: Reduce code clones to <100. Extract shared patterns into reusable utilities._

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

**Target**: <100 clones or <1.5%. Currently 126 clones.

---

## 📅 Next Epic: Package Extraction

_Focus: Reduce common-types export bloat and split bot-client, the largest package._

**Codebase snapshot (2026-02-12)**: 108K hand-written production LOC + 45K Prisma-generated.

| Package      | Files | LOC | Exports | Status                                                                              |
| ------------ | ----- | --- | ------- | ----------------------------------------------------------------------------------- |
| bot-client   | 254   | 46K | 767     | **Outlier** — nearly half the codebase, primary extraction target                   |
| ai-worker    | 105   | 19K | —       | Healthy                                                                             |
| api-gateway  | 104   | 17K | —       | Healthy                                                                             |
| common-types | 99    | 16K | 607     | LOC is fine (45K "bloat" was Prisma-generated); **607 exports** is the real problem |
| tooling      | 61    | 9K  | —       | Fine                                                                                |

### Phase 1: Assessment

- [ ] Reassess common-types export count — categorize exports by domain to identify extraction boundaries
- [ ] Profile bot-client's 46K lines — which subdirectories are self-contained?
- [ ] Reference: PR #558 analysis

### Phase 2: Extraction

- [ ] Candidates: `@tzurot/discord-dashboard` (30 files, self-contained), `@tzurot/message-references` (12 files), `@tzurot/discord-command-context` (6 files)
- [ ] Re-evaluate whether common-types needs splitting or just export pruning

**Previous work**: Architecture Health epic (PRs #593–#597) completed dead code purge, oversized file splits, 400-line max-lines limit, and circular dependency resolution (54→25, all remaining are generated Prisma code).

---

## 📦 Future Themes

_Epics ordered by dependency. Pick the next one when current epic completes._

### Theme: Memory System Overhaul

_Dependency chain: Configuration Consolidation → LTM Summarization → Table Migration → OpenMemory_

#### 1. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

#### 2. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

#### 3. 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage.

- [ ] Design waypoint graph schema
- [ ] Migration path from current flat memories
- [ ] See `docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md`

#### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

#### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

---

### Theme: Character Portability

_Import and export characters and user data. Users own their data._

#### ✨ User Data Export

Unified export of all user-owned data. Currently preset export and character export exist but are separate.

- [ ] `/persona export` command - download all user data as JSON/ZIP
- [ ] Include: personas, presets, LLM configs, memories, conversation history
- [ ] Include: user settings, timezone, API keys (masked)
- [ ] Consider: character cards (PNG with embedded metadata) for personalities
- [ ] Privacy: only export data the user owns or has created

**Existing partial implementations**: `/preset export`, `/character export`

#### ✨ Character Card Import

Import V2/V3 character cards (PNG with embedded metadata). SillyTavern compatibility.

- [ ] Parse PNG metadata (V2 JSON in tEXt chunk, V3 in separate format)
- [ ] Map character card fields to v3 personality schema
- [ ] `/character import` support for PNG files

#### ✨ Shapes.inc Import

Phases 1-4 shipped (PRs #593-#662): schema, data fetcher, import pipeline, `/shapes` commands. Remaining backlogged phases:

- [ ] Phase 5: Sidecar prompt injection (depends on "User System Prompts" feature)
- [ ] Phase 6: Voice/image field import (voice tracked in Voice Engine Phase 5; image deferred)
- [ ] Phase 7: Training data import (needs training data schema first)
- [ ] Phase 8: Resolve memory sender UUIDs to display names via shapes.inc API
- [ ] Phase 9: Configurable export sections (`include_config`, `include_memories`, etc.)

---

### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

#### ✨ User System Prompts (Sidecar Prompts)

Per-user text injected into the system message, shaping how characters interact with that specific user. Shapes.inc calls this "user personalization" — a freeform backstory (~3KB) the user writes about themselves per character. During shapes.inc import, this data is preserved in `customFields.sidecarPrompt` JSONB.

- [ ] Add `sidecarPrompt` field to `UserPersonalityConfig` (per-user-per-character) or `User` (global)
- [ ] Prompt assembly: inject sidecar text into system message (after character profile, before conversation)
- [ ] `/persona` dashboard upgrade to edit sidecar prompt
- [ ] Migration: move shapes.inc imported `customFields.sidecarPrompt` to proper field

#### ✨ Channel Allowlist/Denylist

Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

#### ✨ Multi-Character Invocation Per Message

Support tagging multiple characters in one message, each responding in order.

**Example**: `@character1 @character2 hello both` → both respond sequentially

- [ ] Modify mention extraction to return array of all valid mentions
- [ ] Combine reply target + mentions into ordered list (reply first, then mentions L→R)
- [ ] Add max limit (3-4 characters per message) to prevent abuse

#### ✨ Emoji Reaction Actions

Allow emoji reactions to trigger personality actions.

- [ ] Define action mapping (❤️ = positive feedback, 👎 = regenerate, etc.)
- [ ] Hook into reaction events (reactionAdd handler)
- [ ] Action dispatch based on emoji → action mapping

#### ✨ Denylist Duration Support

Allow `/deny` entries to have an optional expiration for temporary bans (e.g., `duration:24h`). Requires `expiresAt` column, filter check, and BullMQ cleanup job.

#### ✨ Transcript Spoiler Word List

Admin-managed list of words to auto-spoiler in voice transcripts (`||word||`). Add `spoilerWords` string array to `AdminSettings` JSONB with case-insensitive word-boundary matching.

#### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context. Extract emoji URLs from `<:name:id>` format, sticker URLs from message stickers, include alongside attachments.

---

### Theme: Model Configuration Overhaul

_Redesign how models are configured. Bundle paid/free/vision into reusable profiles._

#### ✨ LLM Config Profiles (Meta Configs)

Current LlmConfig is a single model. Redesign as **profiles** that bundle paid + free models together, so the system can auto-fallback and users pick a profile rather than individual models.

**Core concept**: A profile is a named container with a description/purpose (e.g., "General Purpose", "NSFW", "Coding") that holds:

- Paid model config (model, temperature, max tokens, etc.)
- Free model config (fallback when quota/billing isn't available)
- Vision model config (bundled in — changing the global vision model should be one action, not per-LlmConfig)

**Cascade integration**: Profiles apply at all 4 config cascade levels — admin global default, personality default, user global default, user-personality override. Vision model inherits from the profile by default but users can override at any tier.

**User-facing**:

- Admin creates global profiles (themed defaults everyone can use)
- Users can create their own profiles (global/non-global, like personalities)
- `/preset` system may merge into or coexist with this

**Open questions**:

- Relationship to existing `Preset` system — replace, merge, or layer on top?
- How many vision profile themes are actually needed? (general, NSFW, document — or just general + NSFW)
- Character-level free model default (does it exist today? needs investigation)

#### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

#### 🏗️ Vision Model as Full LLM Config

Currently vision model is just a model name string. Promote to a full `LlmConfig` reference (temperature, max tokens, system prompt, etc.) — but exclude the `visionModel` field itself (no recursive vision config). Likely folded into profiles above.

---

### Theme: Next-Gen AI Capabilities

_Future features: agentic behavior, multi-modality, advanced prompts._

#### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

- **Lorebooks / Sticky Context** - Keyword-triggered lore injection with TTL
- **Author's Note Depth Injection** - Insert notes at configurable depth in conversation
- **Dynamic Directive Injection** - Anti-sycophancy prompt techniques

#### Agentic Features

_Self-directed personality behaviors._

- **Agentic Scaffolding** - Think → Act → Observe loop
- **Dream Sequences** - Self-reflection and memory consolidation
- **Relationship Graphs** - Track relationships between users and personalities

#### Multi-Modality

_Beyond text: voice and images._

- **Image Generation** - AI-generated images from personalities

---

### Theme: Voice Engine

_Focus: Two-tier voice system (self-hosted free + ElevenLabs BYOK premium) for both STT and TTS._

**Status**: Phases 1–4.6 shipped. Free tier (Parakeet TDT + Pocket TTS) in v3.0.0-beta.89. ElevenLabs BYOK (Phase 4) in PR #727. Configurable TTS model + cleanup (Phase 4.6) in PR #729. Dev-testing fixes (scoped-key detection, voice auto-reclone, STT userId) in v3.0.0-beta.90.

| Tier               | STT                         | TTS               |
| ------------------ | --------------------------- | ----------------- |
| Free (self-hosted) | NVIDIA Parakeet TDT 0.6B v3 | Kyutai Pocket TTS |
| Premium (BYOK)     | ElevenLabs Scribe v2        | ElevenLabs v3     |

#### Phases 1-4.6 (COMPLETE)

All shipped across beta.89-90 + PRs #710, #727, #729, #731-733. Key milestones:

- **Phase 1**: Python FastAPI voice-engine service (Parakeet TDT STT + Pocket TTS), Railway Serverless
- **Phase 2**: ai-worker VoiceEngineClient integration, replaced Whisper STT
- **Phase 3/3b**: TTS pipeline (TTSStep, chunked synthesis, Redis audio storage), `/character voice` command, config cascade wiring
- **Phase 4/4.5**: ElevenLabs BYOK (TTS, STT, voice cloning, slot management), Whisper removal
- **Phase 4.6**: Configurable TTS model (`/settings voices model`), CPD cleanup (152→146)

See git history for detailed task lists.

#### Phase 5: Shapes.inc Voice Field Import

Import voice configuration from shapes.inc character data.

- [ ] Map shapes.inc `voice_model`, `voice_id`, `voice_stability` fields to Tzurot voice config
- [ ] Set `voiceEnabled: true` for imported characters with voice data
- [ ] Create voice states from imported reference audio if available

**Research**: `docs/research/voice-cloning-2026.md`

#### 🐛 Voice Pipeline Resilience (Cold Start + Timeout Architecture)

Intermittent failures from Railway Serverless cold starts (~56s). Significant progress made in beta.92 and beta.93 work:

**Completed:**

- [x] STT bot-client timeout (`AbortSignal.timeout(120s)`) — PR #757
- [x] Adaptive TTS timeout (150s ElevenLabs, 240s voice-engine) — PR #757
- [x] Warmup polling returns `{ ready, elapsedMs }` for observability — PR #757
- [x] Timeout-aware user error messages — PR #757
- [x] ECONNREFUSED retry resilience for both TTS and STT — PR #759

**Remaining:**

- [ ] Parallel TTS chunking — synthesize chunks concurrently instead of sequentially (long messages still bottleneck)
- [ ] Better user feedback during STT wait — "Transcription in progress..." → "Taking longer than expected..." → error
- [ ] Transcription retry outcome surfacing — user sees generic error, not retry status

---

### Theme: Logging & Error Observability

_Comprehensive audit of logging quality, error serialization, and log hygiene across the stack._

#### 🐛 Error Serialization Audit

During the GLM-5 empty response investigation, `err` serialized as `{_nonErrorObject: true, raw: "{}"}` despite being a real `Error`. Makes logs nearly useless for debugging provider issues.

- [ ] Audit LangChain throwing non-Error objects that look like Errors
- [ ] Audit Node `undici` fetch errors — `TypeError` from `fetch()` serializes as `raw: "{}"` in Pino (non-enumerable properties). Seen in `GatewayClient.submitJob()` and `PersonalityMessageHandler` on Railway dev (2026-02-15)
- [ ] Review `normalizeErrorForLogging()` in `retry.ts` wrapping behavior
- [ ] Review `determineErrorType()` in `logger.ts` checking `constructor.name`
- [ ] Codebase-wide scan for `{ err: ... }` patterns that produce useless output
- [ ] Goal: every `{ err: ... }` log shows message + stack, never `raw: "{}"`

#### 🐛 Inadequate LLM Response Detection

Compound scoring heuristic to detect garbage 200 OK responses (e.g., glm-5 returned just `"N"`, 1 token, `finishReason: "unknown"`, 160s). All signals already collected by `DiagnosticCollector` but timing data needs threading through `RAGResponse`. Integrates into PR #702's retry loop via `FallbackResponse` ranking.

**Signals**: `finishReason` unknown/error (+0.4), `completionTokens` ≤1/≤5 (+0.3/+0.15), no stop sequence + short (+0.2), extreme ms-per-token (+0.2), empty content (+0.3). Threshold: ≥0.5. Max 1 content retry.

**Files**: `ConversationalRAGTypes.ts` (add timing field), `ConversationalRAGService.ts` (thread timing), `RetryDecisionHelper.ts` or new scorer, `GenerationStep.ts` (call scorer), tests.

**Reference**: `debug/debug-compact-736e6c99-*.json`

#### 🏗️ Per-Attempt Diagnostic Tracking in Retry Loop

When the fallback response path is used (PR #672), the diagnostic payload has data from attempt 1 (token counts, model, raw content) but `llmInvocationMs: undefined` because timing was reset for attempt 2 which failed. Add a `diagnosticAttempt` field or per-attempt timing array so the payload is internally consistent about which attempt's data it contains.

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG. Noisy logs obscure real issues in production.

- [ ] Audit all `logger.info()` calls — demote routine operations to DEBUG
- [ ] Ensure ERROR/WARN are reserved for actionable items
- [ ] Review hot paths (message processing, cache lookups) for excessive logging

#### 🏗️ Consistent Service Prefix Injection

Auto-inject `[ServiceName]` prefix in logs instead of hardcoding in every log call.

- [ ] Extend Pino logger factory to auto-add service name prefix
- [ ] Remove manual `[ServiceName]` prefixes from log messages
- [ ] Consider structured `service` field instead of string prefix

#### 🏗️ Audit Error Sanitization in Log Pipeline

Two gaps: (1) Enumerable Error properties (e.g. Axios `error.config.url`) bypass `sanitizeObject()` early-return for `instanceof Error`. (2) `getErrorContext` callback results spread into log objects without sanitization. Check OpenRouter/LangChain error objects, document API contract. Discovered during PR #700.

#### ✨ Admin/User Error Context Differentiation

Admin errors should show full technical context; user errors show sanitized version. Partially done in PR #587 (error display framework shipped), this is the remaining differentiation.

- [ ] Admin error responses include stack traces and internal context
- [ ] User-facing errors show friendly messages without internals

---

### Theme: Observability & Tooling

_Backend health: monitoring, debugging, developer experience._

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns to database for admin updates without deployment.

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [ ] **CPD**: Currently non-blocking in pre-push. Once under target (<100 clones), add threshold check that blocks push
- [ ] **Duplicate Exports**: `guard:duplicate-exports` runs in CI with `continue-on-error: true`. Add ratchet (baseline count file + "new duplicates above baseline" check) so it blocks CI while still allowing existing allowlisted duplicates. Then drop `continue-on-error`
- [ ] **ESLint warnings**: `max-statements`, `complexity`, `max-lines-per-function` are warn-level. Audit current violation count, set a baseline, block new violations
- [ ] **Knip**: Dead code detection runs manually. Add to pre-push or CI as blocking check

Goal: every quality check that currently warns should eventually block, with a clear baseline so new violations are caught immediately.

#### 🏗️ Schema-Type Unification (Zod `z.infer`)

Adopt `z.infer<typeof schema>` across all job types to eliminate manual interface/schema sync. Currently each job type has both a Zod schema and a hand-written TypeScript interface that must be kept in sync manually.

- [ ] Replace `ShapesImportJobData` / `ShapesImportJobResult` interfaces with `z.infer<>` derivations
- [ ] Do the same for `AudioTranscriptionJobData`, `ImageDescriptionJobData`, `LLMGenerationJobData`
- [ ] Consider discriminated unions for success/failure result types (compile-time enforcement that `personalityId` is required on success, `error` is required on failure)
- [ ] Audit all Zod schemas in common-types for interface/schema drift

**Context**: PR #651 added Zod schemas for shapes import jobs and an enforcement test that catches missing schemas. This follow-up eliminates the remaining duplication.

#### 🏗️ Investigate Safe Auto-Migration on Railway

Prisma migrations are currently manual post-deploy (`pnpm ops db:migrate --env dev/prod`). This caused a P2002 bug when a migration was deployed as code but never applied. Investigate: dev-only auto-migration in start command, pre-deploy hook with `prisma migrate deploy`, CI step that validates migration state matches schema.

#### 🏗️ API Gateway Middleware Wiring Integration Tests

Add supertest-style integration tests that boot the actual Express app with real middleware. Verifies auth middleware is correctly applied (factory functions called, not just passed), routes respond properly, error middleware works. Audit `router.use(...)` calls for missing `()` on factory functions. Discovered during PR #691.

#### 🧹 Ops CLI Command Migration

Migrate stub commands to proper TypeScript implementations.

---

## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Personality Aliases** - User-managed alternative names for personalities. v2 had: multi-word aliases (1-4 words, longest-match priority), smart collision handling (append name parts, then random suffix), auto-alias creation from display names, and alias reassignment between personalities. Single-level indirection only (alias → personality ID, no chains). v3 already has `PersonalityAlias` model in schema.
- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Partially done: migrated from `include_reasoning` to modern `reasoning` param via `modelKwargs`. But the custom fetch wrapper in `ModelFactory.ts` that intercepts raw OpenRouter HTTP responses and injects `<reasoning>` tags is still fragile — LangChain's Chat Completions converter silently drops `reasoning` fields, so we intercept before it parses. Needs a cleaner approach (e.g., native Responses API support from OpenRouter, or a LangChain plugin).

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Prompt Caching (Anthropic)

Add `cache_control` breakpoints to static prompt sections (character profile, response protocol) for Anthropic models via OpenRouter. Deferred Phase 4 from the XML prompt restructure.

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

### Code Quality

#### 🏗️ Unify Shapes Job Error Handlers

`handleExportError` (ShapesExportJob.ts) and `handleImportError` (ShapesImportJob.ts) are near-identical: `willRetry` computation, three-way log message, re-throw or mark DB as failed. Extract to a shared helper in `shapesCredentials.ts` or a new `shapesJobHelpers.ts`.

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

### Low-Priority Audits

- **Audit API Routes for Zod Validation** — Several routes use manual `typeof` + `isValidDiscordId()` instead of Zod schemas at boundaries. Large scope, no recent production impact. Discovered PR #688.
- **DB-Sync Deletion Propagation** — Cross-env sync only upserts, so prod deletions get undone on re-sync. Workaround: manual cleanup. Needs design decision (tombstones, deletion log, sync manifest). Low urgency.

### Nice-to-Have Features

- **Release Notifications** - `/changelog` command, announcement channel, GitHub webhook
- **Remove Dashboard Close Button** - Redundant with Discord's native "Dismiss Message" on ephemeral messages. Sessions auto-expire via Redis TTL (15 min) anyway.
- **Align Preset Browse UX with Character Browse** - Characters group by owner with clear section headers and consistent emoji badges (from the Emoji Standardization epic). Presets still use a flat list with ad-hoc badging. Needs: owner grouping, standardized emoji badges, consistent legend formatting.

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🏗️ Slash Command UX Audit

Full audit of all slash command UI patterns. Review shared utilities usage, identify gaps/inconsistencies, standardize patterns.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

---

## ⏸️ Deferred

_Decided not to do yet._

| Item                                        | Why                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema versioning for BullMQ jobs           | No breaking changes yet                                                                                                                      |
| Contract tests for HTTP API                 | Single consumer, but middleware wiring tests needed (see Inbox). Revisit after wiring audit.                                                 |
| Redis pipelining                            | Fast enough at current traffic                                                                                                               |
| BYOK `lastUsedAt` tracking                  | Nice-to-have, not breaking                                                                                                                   |
| Handler factory generator                   | Add when creating many new routes                                                                                                            |
| Scaling preparation (timers)                | Single-instance sufficient for now                                                                                                           |
| Denylist batch cache invalidation           | Single pubsub messages handle current scale; premature optimization for bulk ops that rarely happen                                          |
| Deny detail view DashboardBuilder migration | Action-oriented UI (toggle/edit/delete) doesn't fit multi-section edit dashboard pattern; already uses SessionManager and DASHBOARD_MESSAGES |
| `memory_only` import ownership check        | Not a bug — memory_only imports should work across personality owners since memories belong to the importing user, not the personality owner |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- Shapes.inc import: Phases 1-4 complete on develop (see Character Portability theme)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md) - Voice engine research summary + implementation map
