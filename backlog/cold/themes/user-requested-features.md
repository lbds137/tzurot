### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
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

#### ✨ Multi-Character Invocation Per Message

Support tagging multiple characters in one message, each responding in order.

**Example**: `@character1 @character2 hello both` → both respond sequentially

- [ ] Modify mention extraction to return array of all valid mentions
- [ ] Combine reply target + mentions into ordered list (reply first, then mentions L→R)
- [ ] Add max limit (3-4 characters per message) to prevent abuse

#### ✨ Message-Action Affordances: edit / regenerate / delete / ping (emoji reactions + edit flow)

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
