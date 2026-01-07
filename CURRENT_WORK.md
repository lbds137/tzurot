# Current Work

> Last updated: 2026-01-06

## Status: Public Beta Live

**Version**: v3.0.0-beta.38
**Deployment**: Railway (stable)
**Current Goal**: Kill v2 (finish feature parity → delete tzurot-legacy)

---

## Active: Memory Management Commands (Phase 2)

**Reference**: [docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md](docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md)

**Phase 1 (STM) - COMPLETE** (shipped in beta.19):

- [x] `/history clear`, `/history undo`, `/history hard-delete`, `/history view`
- [x] Per-persona epoch tracking

**Phase 2 (LTM) - NOT STARTED:**

- [ ] `/memory search` - Semantic search with filtering
- [ ] `/memory browse` - Paginated memory deck UI
- [ ] `/memory edit` - Edit memory content (regenerate embedding)
- [ ] `/memory delete` - Single memory deletion
- [ ] `/memory purge` - Bulk deletion with typed confirmation
- [ ] `/memory lock/unlock` - Core memory protection

**Phase 3 (Incognito) - NOT STARTED:**

- [ ] `/incognito enable/disable/status/forget`

---

## High Priority (Deferred): DRY Message Extraction Refactor

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

| #   | Feature                  | Why                                              |
| --- | ------------------------ | ------------------------------------------------ |
| 1   | **Memory Management** ⬅️ | Phase 2 (LTM) - user-requested, privacy control  |
| 2   | **Shapes.inc Import**    | Unblocks v2 deletion - users need migration path |
| 3   | **DM Personality Chat**  | Biggest v2 feature gap, user-requested           |
| 4   | **Dashboard Pattern**    | Fix UX before adding complex features            |
| 5   | **NSFW Verification**    | User-level, one-time via age-gated channel       |

See [ROADMAP.md](ROADMAP.md) for full details.

---

## Recent Highlights

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
