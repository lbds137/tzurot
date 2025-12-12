# Current Work

> Last updated: 2025-12-12

## Status: Public Beta Live

**Version**: v3.0.0-beta.17
**Deployment**: Railway (stable)
**Priority**: Close half-baked features before adding new ones

---

## Immediate Focus

### Priority 1: UX Dead Ends

| Task                   | What's Broken                                | Status      |
| ---------------------- | -------------------------------------------- | ----------- |
| `/preset edit`         | Users can create/delete presets but NOT edit | Not started |
| `advancedParameters`   | Schema exists, API routes ignore it          | Not started |

### Priority 2: User Self-Service

| Task             | User Pain                    | Status      |
| ---------------- | ---------------------------- | ----------- |
| `/history clear` | No way to reset conversation | Not started |

### Priority 3: User Requests (DO NOT START YET)

- DM Personality Chat (multiple user requests)
- PluralKit JSON import
- Shapes.inc import

---

## Recent Releases

### v3.0.0-beta.17 (2025-12-12)

- **Name collision disambiguation** - Shows `Name (@username)` when persona name matches personality name
- **Help command update** - Added `/character chat` reference for consistency

### v3.0.0-beta.16 (2025-12-11)

- Lint cleanup (max-depth, max-params warnings eliminated)
- Bot mention help message with `/character chat` guidance

---

## Known Issues

- **142 lint warnings** - mostly complexity issues (functions >15 complexity, >100 lines)
- **DRY violation** - `me/model/autocomplete.ts` duplicates shared autocomplete utility
- **Autocomplete UX** - should include slug in parentheses for personalities with same name

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
- `/preset global` - Global preset management (create, edit, set-default, set-free-default)
- `/character` - Personality CRUD (create, edit, delete, view, list, avatar, import, export, chat)

**Special:**
- BYOK (Bring Your Own Key) via `/wallet` commands
- Free model guest mode
- Custom error messages per personality
- Memory scope via `/me profile share-ltm`

---

## Quick Links

- **[ROADMAP.md](ROADMAP.md)** - Master roadmap with all sprints
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - Feature parity tracking

---

_This file reflects current focus. Updated when switching context._
