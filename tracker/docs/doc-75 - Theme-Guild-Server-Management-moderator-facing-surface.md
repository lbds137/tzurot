---
id: doc-75
title: 'Theme: Guild / Server Management (moderator-facing surface)'
type: other
created_date: '2026-08-11 20:14'
---

### Theme: Guild / Server Management (moderator-facing surface)

_Focus: make the bot administrable by the people responsible for a server, not just by each user for themselves._

**Origin (owner, 2026-08-11):** a user's support questions were answered against
the wrong mental model. Xeo asked three things in #general — a channel-wide
memory reset, whether the "global" memory setting could be raised, and whether
history distinguishes people after a nickname change — and every answer assumed
they were asking as an individual user. They were asking as a **server
moderator**. The owner's framing: _"right now most of our focus has been on user
level. the channel stuff they want is probably as a moderator in a Discord
server."_

That is the gap this theme names. Nearly every surface is scoped to a single
user acting on their own data. A moderator has a different job — govern a shared
space, on behalf of people who are not them — and the primitives for it are
either missing, non-binding, or invisible.

**The through-line, and the reason this is a theme rather than three tasks:**
the pieces are not independent features. A moderator who sets a channel value
believes it took effect (TASK-529 — it did not, the user tiers outrank it),
cannot tell from the UI who it applies to (TASK-527), and cannot act on the
channel as a unit when they need to (TASK-526). Fixing any one alone leaves a
moderator with a coherent-looking surface that still misleads them. The
cross-cutting question every phase has to answer is the same: **when does a
server's authority outrank an individual's, and how does each side see that?**

That question has a defensible answer of "never" — a user's conversations and
preferences are genuinely theirs, and Tzurot is not primarily a moderation tool.
Deciding that explicitly and saying so in the UI is a valid outcome for this
theme; what is not valid is the current state, where the answer is "never" by
accident and nothing discloses it.

### Phase 1 — Truthfulness (do not lie to moderators) — NEXT

The cheapest phase and the only one with a live correctness defect. Ships
regardless of what gets decided about authority, because both possible answers
require the surface to stop misrepresenting itself.

- [ ] **TASK-529** — the cascade is `hardcoded < admin < personality < channel < user-default < user+personality`, so a channel-tier value is a DEFAULT for users who never set the field and is silently overridden for everyone who did. `state:owner`: does a moderator get authority over a setting a user chose for themselves, in that server's channel only? Decide before building. Verified in `packages/config-resolver/src/ConfigCascadeResolver.ts:5-14`.
- [ ] **TASK-527** — no dashboard states whose conversations a tier affects. The scope line must carry the override DIRECTION ("applies to members who have not set their own"), not just the scope, or it becomes a more confident wrong impression than saying nothing. One edit in the shared `utils/dashboard/settings/` covers every level.

### Phase 2 — Acting on a channel as a unit

- [ ] **TASK-526** — channel-wide conversation reset. Every clear path is keyed `(channelId, personalityId, personaId)` and requires naming one character, so six characters means six resets. The service layer is already moderator-capable: `ConversationRetentionService.clearHistory` takes `personaId` **optionally** — omit it and it clears every persona's rows for that character. What is missing sits above: a mod-authorized route (today's only caller is the actor-scoped `/api/user/history/clear`), iteration across the channel's characters, a Manage Messages gate, and a Tier B typed-phrase confirmation. `state:owner` on blast radius — this deletes rows belonging to users who are not present and did not ask.

### Phase 3 — Keeping the bot out of where it is not wanted

- [ ] **Channel allowlist/denylist** — MOVED here from doc-26's User-Requested Features, where it sat among unrelated one-off requests. It is squarely this theme: its own rationale is _"prevents bot from spamming unwanted channels, reduces server kicks"_ and its command is scoped to server admins. Sketch as filed: `mode` (allowlist/denylist) + `channels` array on ChannelSettings, a `/channel restrict` command, a middleware check in the message handler, and a possible "Ghost Mode" (bot listens, replies only when pinged). Re-verify the sketch against current code before building — it predates several changes to channel settings.

### Phase 4 — Identity in a shared room (adjacent, gated on Phase 1)

- [ ] **TASK-528** (high, confirmed defect) — two users sharing a persona name collapse into one `<participants>` entry, because `participantPersonas` is keyed by NAME while its dedup index is keyed by personaId. A shared moderated channel is exactly where two people pick the same name. Owner decision on the fix shape: **both render, same label** — key by `personaId`, display name in the value; no suffixes, no hint line. Listed here for context; it is independently startable and does not wait on this theme.

### Not in scope

- Bot-owner moderation (`/deny`, the denylist, admin settings) — that is
  operator tooling, a different actor from a server moderator, and it already
  works.
- Anything requiring a Discord permission Tzurot does not already request.

### Grounding notes for whoever picks this up

- `services/bot-client/src/commands/channel/settings.ts` is the reference for
  moderator authorization: it reads `interaction.memberPermissions`, NOT
  `context.member.permissions`, because the latter is guild-wide and blind to
  per-channel overwrites. Its comment explains why at length — read it before
  writing a second permission check.
- The channel tier of the config cascade already exists and already carries
  `MEMORY_SETTINGS`, `EXTENDED_CONTEXT_SETTINGS`, `DISPLAY_SETTINGS` and
  `VOICE_CASCADE_SETTINGS`. The gap is authority and legibility, not plumbing.
- A user asked for all of this unprompted, which makes it real demand rather
  than a speculative capability area — but only one user has asked, so size the
  phases accordingly.
