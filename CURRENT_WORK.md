# Current Work

> Last updated: 2026-01-17

## Status: Public Beta Live

**Version**: v3.0.0-beta.41
**Deployment**: Railway (stable)
**Current Goal**: User-Requested Features (v2 parity deprioritized)

---

## Active: Duplicate Detection & OpenAI Eviction Epic

**Reference**: [`.claude/plans/snug-beaming-quilt.md`](.claude/plans/snug-beaming-quilt.md)

**Problem**: Users experience repetitive AI responses despite existing detection. Root cause: bigram Dice coefficient measures _spelling_ similarity, but free models have _semantic_ caching that returns identical content with minor variations.

**Solution**: Multi-layer "Swiss Cheese" detection + escalating retry strategy.

**Phases 1-5 (COMPLETE)**:

- [x] **Phase 1**: Word Jaccard similarity (Layer 2) - Catches same words with different formatting
- [x] **Phase 2**: Local embedding service (bge-small-en-v1.5 via Worker Thread)
- [x] **Phase 3**: Semantic embedding layer (Layer 4) - Catches meaning equivalence at 0.88 cosine threshold
- [x] **Phase 4**: Escalating retry strategy ("Ladder of Desperation"):
  - Attempt 1: Normal generation
  - Attempt 2: Temperature 1.1, frequency penalty 0.5
  - Attempt 3: Also reduce history by 30%
- [x] **Phase 5**: Comprehensive tests (31 new tests for retry config and embedding service)

**Phase 6 (DEV COMPLETE - PENDING PROD DEPLOY)**: LTM Embedding Migration (OpenAI Eviction)

- [x] Created `@tzurot/embeddings` package (shared between ai-worker and api-gateway)
- [x] Database migration: added `embedding_local` column (384-dim BGE)
- [x] Backfill script with column detection, auto-index creation, VACUUM ANALYZE
- [x] Updated PgvectorMemoryAdapter, PgvectorQueryBuilder, memorySearch.ts
- [x] Cleanup migration: renamed `embedding_local` → `embedding`, dropped OpenAI column
- [x] Development environment fully migrated and tested

**Production Deployment** (staggered release required):

1. **Deploy commit `c633ded2`** (pre-cleanup) → Adds `embedding_local`, code switches to it
   - LTM storage works, LTM retrieval broken (~1 hour)
2. **Run backfill**: `pnpm ops run --env prod pnpm --filter @tzurot/scripts run db:backfill-local-embeddings`
   - Script auto-creates index CONCURRENTLY and runs VACUUM ANALYZE
3. **Deploy current develop** (cleanup migration) → Renames column, everything works

**Result**: 50% OpenAI eviction (embeddings). Voice transcription (Whisper) remains a future epic.

---

## Completed: Quick Wins (Tech Debt & Naming)

Fast cleanup before building new features:

- [x] Drop deprecated `BotSettings` table (replaced by `AdminSettings`) ✅ PR #456
- [x] Rename `/me model` → `/me preset` (fix confusing terminology) ✅ PR #456
  - Renamed command group from `model` to `preset`
  - Updated parameter names (`config` → `preset`)
  - Renamed `set-default` → `default` for consistency with `/me profile default`
  - Updated help text and documentation

---

## Active: Memory Management Commands (Phase 2 + Read Toggle)

**Reference**: [docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md](docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md)

**Phase 1 (STM) - COMPLETE** (shipped in beta.19):

- [x] `/history clear`, `/history undo`, `/history hard-delete`, `/history view`
- [x] Per-persona epoch tracking

**Phase 2 (LTM) - COMPLETE** (PR #462, #471):

- [x] `/memory list` - Paginated memory browser with detail view
- [x] `/memory search` - Semantic search with text fallback, pagination
- [x] `/memory stats` - View memory statistics per personality
- [x] Memory detail view with edit, delete, lock/unlock actions
- [x] Shared pagination utility (`paginationBuilder.ts`)
- [x] Focus Mode toggle (`/memory focus`) - API complete
- [x] `/memory delete` - Batch deletion with filters (PR #471)
- [x] `/memory purge` - Bulk deletion with typed confirmation (PR #471)
- [x] Focus Mode RAG integration (ai-worker skips retrieval when enabled)
- [x] Focus Mode visual indicator in responses (`🔒 Focus Mode • LTM retrieval disabled`)

**Phase 3 (Incognito + Recovery + UX Polish) - NOT STARTED:**

Core Features:

- [ ] `/memory incognito enable/disable/status/forget`
- [ ] Visual indicator in responses when incognito active
- [ ] `/memory restore` - restore soft-deleted memories
- [ ] `/memory add` - manually add a memory for a personality
- [ ] Batch operations respect locked memories (`/memory delete`, `/memory purge` skip locked)
- [ ] User-facing guide for memory management commands

UX Naming Review (MCP Council Recommendations):

| Current                | Proposed          | Rationale                                                                           |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `/memory undo`         | `/memory restore` | "Restore" implies archive recovery; "undo" implies immediate reversal (Ctrl+Z)      |
| `/memory focus`        | `/memory pause`   | "Focus" is ambiguous (focus ON memories? or IGNORE them?); "pause" clearly suspends |
| `/memory purge`        | `/memory reset`   | "Reset" feels more final than "purge" which overlaps with "delete"                  |
| `/history hard-delete` | `/history wipe`   | User-facing term vs technical DB term; shorter to type                              |

Additional Considerations:

- **Merge list+search?** Consider `/memory view [query]` - empty shows list, filled does semantic search
- **Verb consistency**: `/history view` vs `/memory list` - pick one pattern
- **Confirmation UX**: `/memory reset` should require typing personality name (already implemented in purge)

STM Command Polish (Optional - bundle with Phase 3):

| Current                | Proposed           | Rationale                                        |
| ---------------------- | ------------------ | ------------------------------------------------ |
| `/history hard-delete` | `/history wipe`    | User-facing term; "hard-delete" is DB jargon     |
| `/history clear`       | `/history archive` | Clarifies soft-delete behavior (can be restored) |

_Beta = breaking changes expected. Consider bundling STM renames with Phase 3 for a single "UX consistency pass" across all memory/history commands._

---

## Deferred: DRY Message Extraction Refactor

**Plan**: [`.claude/plans/rustling-churning-pike.md`](.claude/plans/rustling-churning-pike.md)
**Tech Debt Tracking**: [`docs/proposals/active/TECH_DEBT.md`](docs/proposals/active/TECH_DEBT.md)

**Problem**: Two parallel message processing paths (main vs extended context) keep diverging.

**Solution**: Intermediate Representation (IR) pattern - single extraction function, both paths consume.

---

## TODO: ESLint Warnings

**Current**: 72 warnings (was 110)

Key areas remaining:

- `MessageContentBuilder.ts` - complexity 37 (deferred: needs IR pattern refactor)
- `SettingsModalFactory.ts` - complexity 26 (parsing logic inherent)

---

## Follow-ups

- [ ] Add ESLint rule to detect `findMany` without `take` limit
- [ ] Consider removing `@default(uuid())` from Prisma schema

---

## Next Up

| #   | Feature                           | Why                                                     |
| --- | --------------------------------- | ------------------------------------------------------- |
| 1   | ~~Quick Wins~~ ✅                 | Drop BotSettings, rename `/me model` → `/me preset`     |
| 2   | ~~Memory Management Phase 2~~ ✅  | LTM commands + Read Toggle ("Focus Mode")               |
| 3   | **Channel Allowlist/Denylist** ⬅️ | User-requested - prevents unwanted channel responses    |
| 4   | **Dashboard + User Prompts**      | Session manager, preset editing, sidecar system prompts |
| 5   | **DM Personality Chat**           | User-requested - chat with personalities in DMs         |
| 6   | **v2 Parity** (deprioritized)     | NSFW verification, Shapes import                        |

See [ROADMAP.md](ROADMAP.md) for full details.

---

## Recent Highlights

- **Upcoming**: Swiss Cheese duplicate detection (4 layers: hash → Jaccard → bigram → semantic embedding), escalating retry strategy (temp 1.1, freq penalty, history reduction), local embedding service (bge-small-en-v1.5 via Worker Thread)
- **beta.41**: Memory management Phase 2 complete - `/memory list`, `/memory search`, `/memory stats`, detail view with edit/delete/lock, `/memory delete` (batch), `/memory purge` (typed confirmation), Focus Mode with visual indicator
- **beta.40**: Enhanced duplicate detection diagnostics (near-miss logging, similarity metrics, hash tracking), integration test for full duplicate detection data flow, Persona resolver improvements
- **beta.39**: SafeInteraction wrapper to prevent InteractionAlreadyReplied errors, discord: format personaIds to UUIDs, stale job cleanup fixes
- **beta.38**: Ordered response delivery (responses appear in message order), hallucinated turn prevention via prioritized stop sequences, finish_reason diagnostic logging
- **beta.37**: BYOK API key leak fix, multi-turn duplicate check (last 5 messages), voice transcript fixes, GitGuardian integration
- **beta.36**: Chunked message sync fix, DRY duplicate detection refactor, dependency updates (Node 25 types, Zod 4.3)
- **beta.35**: Cross-turn duplication detection (entropy injection + Dice coefficient), 2-retry strategy for cached responses
- **beta.34**: Documentation restructure, LTM/STM confusion prevention
- **beta.33**: Identity/memory bug fixes, pretest clean hooks for CJS/ESM conflicts

Full release history: [GitHub Releases](https://github.com/lbds137/tzurot/releases)

---

## Quick Links

- **[ROADMAP.md](ROADMAP.md)** - Full roadmap with priorities
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context
- [docs/proposals/active/TECH_DEBT.md](docs/proposals/active/TECH_DEBT.md) - Tech debt tracking

---

_This file reflects current focus. Updated when switching context._
