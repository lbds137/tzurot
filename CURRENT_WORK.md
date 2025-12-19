# Current Work

> Last updated: 2025-12-18

## Status: Public Beta Live

**Version**: v3.0.0-beta.23
**Deployment**: Railway (stable)
**Current Goal**: Kill v2 (finish feature parity → delete tzurot-legacy)

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
