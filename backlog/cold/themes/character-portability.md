### Theme: Character Portability

_Focus: import and export of characters and user data — users own their data._

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
