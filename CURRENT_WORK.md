# Current Work

> Last updated: 2025-12-19

## Status: Public Beta Live

**Version**: v3.0.0-beta.25
**Deployment**: Railway (stable)
**Current Goal**: Kill v2 (finish feature parity → delete tzurot-legacy)

---

## Next Session: Channel List Improvements

**Branch**: `feat/channel-list-improvements`

**Tasks**:

1. **Improve `/channel list` command**:
   - [ ] Add pagination for servers with many activated channels
   - [ ] Require Manage Messages permission to use
   - [ ] Show only current server's channels by default
   - [ ] Add `--all` or admin flag for cross-server view

2. **Investigate HTTP agent pool isolation** (optional optimization):
   - [ ] Check if Discord.js and gateway HTTP clients share connection pools
   - [ ] Consider separate agents to prevent cross-contamination

**Context**: These items were identified during the beta.25 timeout debugging but deferred to keep that PR focused.

---

## Upcoming: Caching Strategy Audit

**Branch**: TBD (after channel list improvements)

**Problem**: Caching approach is scattered across the codebase with increasing technical debt around horizontal scaling. Need a consistent strategy.

**Scope**:
- [ ] Audit all current caching mechanisms (in-memory TTL caches, Redis, etc.)
- [ ] Identify horizontal scaling concerns (what breaks with multiple instances?)
- [ ] Define consistent caching patterns (when to use local vs Redis vs no cache)
- [ ] Document cache invalidation strategies
- [ ] Consider cache warming, stampede prevention, and other production concerns

**Current caching locations** (known):
- `autocompleteCache.ts` - In-memory TTL (personalities/personas per user)
- `GatewayClient.ts` - In-memory TTL (channel activations)
- `VisionDescriptionCache` - Redis-based
- `VoiceTranscriptCache` - Redis-based
- `CacheInvalidationService` - Redis pub/sub for cross-instance invalidation
- Various Prisma query results (no caching?)

**Goal**: Consistent, horizontally-scalable caching that doesn't break when running multiple bot-client instances.

**Tradeoffs to consider**:

| Approach | Pros | Cons |
|----------|------|------|
| In-memory only | Fast, simple | Not shared across instances |
| Redis only | Shared, survives restarts | Network latency on every read |
| In-memory + Redis pub/sub | Fast reads, eventual consistency | Brief inconsistency window, more complex |

**Current state**:

| Cache | Storage | Invalidation | Scaling Issue? |
|-------|---------|--------------|----------------|
| Autocomplete | In-memory | TTL (60s) | Minor - stale data briefly |
| Channel activation | In-memory | TTL (30s) + manual | **Yes** - could miss messages |
| Vision/Voice | Redis | TTL | ✅ Already shared |
| Personality/Persona | In-memory | Redis pub/sub | ✅ Already handled |

**Deliverable**: Standardized caching approach, possibly codified as a `tzurot-caching` skill.

---

## Upcoming: Skills & CLAUDE.md Optimization

**Branch**: TBD (after caching audit)

**Problem**: We added many skills (13 total) but unclear if they're being used consistently or effectively.

**Scope**:
- [ ] Audit current skill usage patterns
- [ ] Research best practices for Claude Code skills optimization
- [ ] Evaluate skill activation triggers - are they firing when expected?
- [ ] Consider consolidating or restructuring skills
- [ ] Review CLAUDE.md organization and effectiveness
- [ ] External research on skill/instruction optimization techniques

**Goal**: Ensure skills are providing consistent value, not just sitting unused.

---

## Completed: v3.0.0-beta.25 (Slash Command Timeout Fix)

**PR #385** merged → [Release v3.0.0-beta.25](https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.25)

**Root Cause**: Discord autocomplete fires HTTP requests on every keystroke. Combined with channel activation checks on every message, this caused HTTP connection pool saturation → 3-second Discord timeout exceeded → "Unknown interaction" error.

**Fixes Applied**:
- TTL cache for personality/persona autocomplete (60s TTL, 500 users max)
- TTL cache for channel activation lookups (30s TTL)
- Moved `deferReply` to top-level interactionCreate handler
- Removed redundant `deferEphemeral` from individual command handlers
- Fixed critical bug: empty persona list incorrectly treated as cache miss

**Test Coverage**: 4,385 tests passing, 100% coverage on autocompleteCache.ts and GatewayClient.ts

---

## Active: Memory Management Commands

**Reference**: [docs/planning/MEMORY_MANAGEMENT_COMMANDS.md](docs/planning/MEMORY_MANAGEMENT_COMMANDS.md)

**Phase 1 (STM) - COMPLETE** (shipped in beta.19):

- [x] `/history clear` - Epoch-based soft reset (hides old messages from AI context)
- [x] `/history undo` - Restore cleared context
- [x] `/history hard-delete` - Permanent deletion with confirmation
- [x] `/history view` - See current context window status
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
- [ ] Visual indicator in responses when active

---

## Next Up

| #   | Feature                  | Why                                              |
| --- | ------------------------ | ------------------------------------------------ |
| 1   | **Memory Management** ⬅️ | Phase 2 (LTM) - user-requested, privacy control  |
| 2   | **Shapes.inc Import**    | Unblocks v2 deletion - users need migration path |
| 3   | **DM Personality Chat**  | Biggest v2 feature gap, user-requested           |
| 4   | **Dashboard Pattern**    | Fix UX before adding complex features            |
| 5   | **NSFW Verification**    | User-level, one-time via age-gated channel       |
| 6   | **Agentic Scaffolding**  | Build capabilities before OpenMemory             |

See [ROADMAP.md](ROADMAP.md) for full details.

---

## Recent Highlights

- **beta.25**: Slash command timeout fix (autocomplete + channel activation caching, top-level deferral)
- **beta.23**: Memory chunking for oversized embeddings, implicit reply fix, regex security fix
- **beta.20**: Avatar auto-resize with GIF animation preservation
- **beta.19**: `/history` commands (STM management)

Full release history: [GitHub Releases](https://github.com/lbds137/tzurot/releases)

---

## Features Working

**Core:**

- @personality mentions + reply detection
- Message references (Discord message links + reply context)
- Webhook management (unique avatar/name per personality)
- Long-term memory via pgvector
- Image attachment + voice transcription support

**User Management:**

- `/wallet` - API key management (set, list, remove, test)
- `/me profile` - Persona management (create, edit, list, default, view, override, share-ltm)
- `/me model` - Model overrides (set, reset, list, set-default, clear-default)
- `/me timezone` - Timezone settings (set, get)
- `/preset` - User presets (create, list, delete) - **missing: edit**
- `/history` - Conversation history (clear, undo, hard-delete, view)

**Admin:**

- `/admin` - Bot owner commands (ping, db-sync, servers, kick, usage, cleanup)
- `/preset global` - Global preset management
- `/character` - Personality CRUD (create, edit, delete, view, list, avatar, export, import, chat, template)

---

## Quick Links

- **[ROADMAP.md](ROADMAP.md)** - Full roadmap with priorities
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

---

_This file reflects current focus. Updated when switching context._
