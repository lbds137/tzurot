# Current Work

> Last updated: 2025-12-30

## Status: Public Beta Live

**Version**: v3.0.0-beta.29
**Deployment**: Railway (stable)
**Current Goal**: Kill v2 (finish feature parity → delete tzurot-legacy)

---

## Just Completed: Markdown Security & Pagination (PR #392, #393)

**Merged** - Security fixes for markdown injection + UX improvements

- ✅ Centralized `escapeMarkdown` using discord.js built-in function
- ✅ Fixed markdown injection in character names, persona fields, guild names, creator names
- ✅ Guild-aware pagination for `/channel list --all` (never mixes guilds on same page)
- ✅ Added markdown escaping pattern to `tzurot-security` skill
- ✅ Comprehensive test coverage (unit + integration tests)

---

## Completed: Skills & CLAUDE.md Optimization

**Done** - Audited and optimized skill structure

- ✅ 14 project-specific skills documented and organized
- ✅ Progressive disclosure pattern in skills
- ✅ CLAUDE.md streamlined with skill references
- ✅ GitHub CLI workarounds documented in `tzurot-git-workflow`

---

## Completed: Caching Strategy Audit (PR #387)

**Merged** - Redis pub/sub invalidation for channel activation cache

- ✅ Comprehensive caching audit - [docs/architecture/CACHING_AUDIT.md](docs/architecture/CACHING_AUDIT.md)
- ✅ `ChannelActivationCacheInvalidationService` - cross-instance cache invalidation
- ✅ `tzurot-caching` skill - cache patterns and horizontal scaling guidance

---

## Completed: Channel List Improvements (PR #386)

All `/channel list` improvements done:

- ✅ Server-scoped filtering (shows only current server by default)
- ✅ Manage Messages permission required
- ✅ Admin `--all` flag for cross-server view (grouped by server)
- ✅ Interactive pagination with buttons
- ✅ Sort toggle (chronological vs alphabetical)
- ✅ Lazy backfill of missing guildId data

---

## Upcoming: HTTP Agent Pool Isolation (Optional)

**Status**: Low priority per caching audit

**When**: Only investigate if HTTP connection issues arise under load

**Scope**:

- [ ] Check if Discord.js and gateway HTTP clients share connection pools
- [ ] Consider separate agents to prevent cross-contamination

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

**Test Coverage**: 4,400+ tests passing across all services

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

- **beta.29**: LTM null handling fix, modal command deferral fix, Node 25 upgrade, typescript-eslint 8.51.0
- **beta.28**: Markdown security fixes, guild-aware pagination, security skill update
- **beta.27**: UserService race condition fix, persona backfill idempotency
- **beta.26**: Channel list improvements, caching strategy audit
- **beta.25**: Slash command timeout fix (autocomplete + channel activation caching, top-level deferral)
- **beta.23**: Memory chunking for oversized embeddings, implicit reply fix, regex security fix

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
