### Theme: User-Requested Features

_Focus: features requested by actual users — high value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel. Prior design work: [`docs/proposals/backlog/multi-personality-support.md`](../../../docs/proposals/backlog/multi-personality-support.md) — check before re-deriving.

**v1 simplification (user decision 2026-07-03): respond in ACTIVATION ORDER, max 5 slots** — the channel holds an ordered list of up to **5** activation slots. Activating appends to the first free slot at the end; deactivating removes that character and compacts the list (relative order preserved, freed slot opens at the END — no re-sorting, no insertion into the middle). Speaker order = slot order. This defers the hard "natural order / who speaks next" orchestration design to a v2 informed by real usage, and makes v1 build-sized rather than a design boulder. Open v1 questions are small: when does everyone respond vs only the @mentioned one, and does a direct @mention jump the queue.

- [ ] Track up to 5 ordered activation slots per channel (append on activate; compact on deactivate, freed slot at the end)
- [ ] v1 speaker order = activation order; @mention targets respond directly
- [ ] v2 (later, usage-informed): natural-order / salience-based speaker selection
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

#### ✅ Multi-Character Invocation Per Message — SHIPPED (MultiTagCoordinator: fan-out, slot-ordered delivery, crash recovery)

#### ✨ PluralKit Interop — system import/sync + proxied-message persona pairing

**DESIGN ACCEPTED 2026-07-05**: [`docs/proposals/backlog/pluralkit-interop.md`](../../../docs/proposals/backlog/pluralkit-interop.md) — uuid-keyed mapping table, link/import/sync (tokens never stored), name-prefilter pairing with the discard privacy contract, hold+idempotency trigger dance; phases: import → pairing → triggers. Build when prioritized.

User request 2026-07-05 (recalled from earlier thinking). Three connected parts for plural systems using PluralKit alongside Tzurot:

1. **PK system export → Tzurot persona import/update**: a user exports their PluralKit system (members: names, avatars, descriptions, pronouns) and imports it to create/update matching Tzurot personas — one persona per system member.
2. **Identity stability via PK's internal IDs**: PK members carry stable internal identifiers that survive display-name changes; store the PK member ID on the imported persona so a **PK-sync** re-import updates in place instead of duplicating, and identity holds even when the proxied webhook name changes.
3. **Proxied-message → persona pairing**: when a PK member speaks (PK webhook proxy), Tzurot should attribute the message to the corresponding imported persona — so the character knows WHO is speaking, the right persona accrues memories, and multi-member conversations attribute correctly.

**Known interactions to ground**: the dormant `isProxyMessage` stub (prior intent in code); the human-users-only invariant (#1464 — PK-proxied messages are webhook/bot messages and may be filtered from context today); prompt-assembly's speaker attribution (accepted design — PK members are distinct speakers); memory's persona scoping (accepted design — memories must accrue to the right member's persona). PK's public REST API likely provides the pairing primitive (message-lookup endpoint) — verify in design grounding.

**Design session queued with the message-actions design** (shared PluralKit research wave, 2026-07-05).

#### ✨ Message-Action Affordances: edit / regenerate / delete / ping (emoji reactions + edit flow)

**DESIGN ACCEPTED 2026-07-05**: [`docs/proposals/backlog/message-actions.md`](../../../docs/proposals/backlog/message-actions.md) — context-menu → ephemeral panel (no reactions v1), Info/Delete → Regenerate → Edit phasing, edit-in-place-first chunk strategy (owner-refined), permissions = triggering user + bot owner. PluralKit research done (mandate below discharged). Build when prioritized.

User request 2026-07-03, expanding the earlier emoji-actions idea. Inspiration is part shapes.inc (emoji-reaction support for a couple of these) and part PluralKit (proxied-message editing; 🔔 bell to ping the proxied user). **Research-first**: PluralKit is open source — study how it does webhook-message editing/reactions for one working reference (not to copy, but as information on one way of doing it). Scope should also include a brainstorming/research pass on adjacent usability improvements that would make Tzurot better.

- [ ] Research pass: PluralKit's edit/reaction mechanics + shapes.inc reaction UX + broader usability-improvement brainstorm (council candidate)
- [ ] **Edit assistant responses** (PluralKit-style, for the invoking user / character owner) — webhook message edit + authorization model
- [ ] **♻️ regenerate** a response that bugged out (re-run generation, replace the webhook message)
- [ ] **❌ delete** a response
- [ ] **🔔 ping** the user a proxied/character message relates to (PluralKit parity)
- [ ] Other action mappings (❤️ positive feedback, 👎 regenerate-variant, etc.)
- [ ] Hook into reaction events (reactionAdd handler) + action dispatch by emoji → action mapping
- [ ] **Consistency invariant (applies to edit/delete/regenerate alike): conversation history AND memories must be updated to match the surviving message content** — an edited/regenerated reply must not leave the old text in history/LTM, and a deleted one must not persist as if it happened

#### ✨ Denylist Duration Support

Allow `/deny` entries to have an optional expiration for temporary bans (e.g., `duration:24h`). Requires `expiresAt` column, filter check, and BullMQ cleanup job.

#### ✨ Transcript Spoiler Word List

Admin-managed list of words to auto-spoiler in voice transcripts (`||word||`). Add `spoilerWords` string array to `AdminSettings` JSONB with case-insensitive word-boundary matching.

#### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context. Extract emoji URLs from `<:name:id>` format, sticker URLs from message stickers, include alongside attachments.
