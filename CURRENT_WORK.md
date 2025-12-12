# Current Work

> Last updated: 2025-12-12

## Status: Public Beta Live

**Version**: v3.0.0-beta.17
**Deployment**: Railway (stable)
**Current Goal**: Kill v2 (finish feature parity → delete tzurot-legacy)

---

## Next Up

| #   | Feature                 | Why                                              |
| --- | ----------------------- | ------------------------------------------------ |
| 1   | **Shapes.inc Import**   | Unblocks v2 deletion - users need migration path |
| 2   | **DM Personality Chat** | Biggest v2 feature gap, user-requested           |
| 3   | **Dashboard Pattern**   | Fix UX before adding complex features            |
| 4   | **NSFW Verification**   | User-level, one-time via age-gated channel       |
| 5   | **LTM & Context Mgmt**  | /history clear, /memory search, optimization     |
| 6   | **Agentic Scaffolding** | Build capabilities before OpenMemory             |

See [ROADMAP.md](ROADMAP.md) for full details.

---

## Recent Releases

### v3.0.0-beta.17 (2025-12-12)

- **Name collision disambiguation** - Shows `Name (@username)` when persona name matches personality name
- **Help command update** - Added `/character chat` reference for consistency

### v3.0.0-beta.16 (2025-12-11)

- Lint cleanup (max-depth, max-params warnings eliminated)
- Bot mention help message with `/character chat` guidance

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

**Admin:**

- `/admin` - Bot owner commands (ping, db-sync, servers, kick, usage)
- `/preset global` - Global preset management
- `/character` - Personality CRUD (create, edit, delete, view, list, avatar, export, chat)

---

## Quick Links

- **[ROADMAP.md](ROADMAP.md)** - Full roadmap with priorities
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

---

_This file reflects current focus. Updated when switching context._
