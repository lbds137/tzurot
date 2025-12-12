# Current Work

> Last updated: 2025-12-11

## Status: Documentation Cleanup Complete, Ready for Implementation

**Current Priority**: Finish half-baked features before adding new ones
**Why**: Users hit dead ends, creates support burden and cognitive overhead

---

## 🎯 Immediate Focus (This Session Forward)

### Priority 1: Close UX Dead Ends

| Task | What's Broken | Status |
|------|---------------|--------|
| `/preset edit` | Users can create presets but NOT edit them | 🔴 Not started |
| `advancedParameters` | Schema exists, API routes ignore it | 🔴 Not started |
| Memory scope | Feature exists but unused | 🔴 Not started |

### Priority 2: User Self-Service

| Task | User Pain | Status |
|------|-----------|--------|
| `/persona` commands | Can only manage personas via DB | 🔴 Not started |
| `/history clear` | No way to reset conversation | 🔴 Not started |

### Priority 3: User Requests (DO NOT START YET)

| Request | Source |
|---------|--------|
| **DM Personality Chat** | Beta user (multiple requests) |
| PluralKit JSON import | User request |
| Shapes.inc import | Future planning |

---

## Recent Session: Documentation Cleanup (2025-12-11)

### What Was Done

1. **Deleted outdated docs**:
   - `docs/planning/V2_FEATURES_TO_PORT.md` (severely outdated - showed BYOK as "not started")
   - `docs/planning/V3_REFINEMENT_ROADMAP.md` (superseded by ROADMAP.md)

2. **Updated V2_FEATURE_TRACKING.md**:
   - Added DM Personality Chat as high priority (user-requested)
   - Added v3 improvement note: use conversation history table for DM personality matching (not name-based like v2)
   - Added Reset Conversation feature
   - Updated auto-response system details

3. **Created v2-patterns-reference.md**:
   - Consolidated valuable v2 patterns: PluralKit, deduplication, rate limiting, DM handling
   - Lean reference doc, not code to copy

4. **Updated ROADMAP.md**:
   - Added DM Personality Chat to Priority 3 and Sprint 6.5
   - Added reference to new v2-patterns-reference.md

### Key Finding

DM personality chat should use conversation history table for matching, not name-based matching (v2's approach fails when multiple personalities have the same name).

---

## Known Issues to Address

- **142 lint warnings** - mostly complexity issues (functions >15 complexity, >100 lines)
- **DRY violation** - `me/model/autocomplete.ts` duplicates shared autocomplete utility
- **Autocomplete UX** - should include slug in parentheses for personalities with same name

---

## v3 Current State

**Deployment**: Railway development environment (public beta)
**Version**: v3.0.0-beta.15
**Status**: Stable and operational

### Features Working

- @personality mentions + reply detection
- Message references (Discord message links + reply context)
- Webhook management (unique avatar/name per personality)
- Long-term memory via pgvector
- Image attachment + voice transcription support
- Slash commands (admin, character, wallet, preset, model, settings, profile)
- BYOK (Bring Your Own Key)
- Free model guest mode

### Half-Baked (Priority 1)

- `/preset edit` - can create but NOT edit
- `advancedParameters` - schema exists, API ignores it
- Memory scope - feature unused

### Not Started (Priority 2+)

- User aliases (schema migration needed)
- `/history clear` (no `/wack` equivalent)
- `/persona` commands (user self-service)
- DM personality chat (user-requested)
- Auto-response, rate limiting, NSFW verification

---

## Quick Links

### Priority Documents

- **[ROADMAP.md](ROADMAP.md)** - THE source of truth (see "Immediate Focus" section at top)
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

### Reference Docs

- [docs/reference/v2-patterns-reference.md](docs/reference/v2-patterns-reference.md) - V2 patterns worth porting
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - Feature parity tracking

### Supporting Docs

- [docs/planning/SLASH_COMMAND_ARCHITECTURE.md](docs/planning/SLASH_COMMAND_ARCHITECTURE.md) - Sprint 7 detailed plan
- [docs/improvements/TECH_DEBT_PRIORITIZATION_2025-11-20.md](docs/improvements/TECH_DEBT_PRIORITIZATION_2025-11-20.md) - Tech debt analysis

---

_This file reflects current focus. Updated when switching context._
