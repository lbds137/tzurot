---
id: doc-105
title: 'Theme: User-installable app (a second product surface)'
type: other
created_date: '2026-09-17 21:50'
---


### Theme: User-installable app (a second product surface)

_Focus: let a user install Tzurot on their account so its commands work in their DMs with other people, group DMs, and servers Tzurot was never invited to — as a deliberately separate surface where characters speak through embeds and only ever see what a command or context menu hands them._

**Owner direction 2026-09-17**: worth investigating, potentially valuable enough to pursue, save for follow-up. Research COMPLETE the same day: [`docs/proposals/backlog/user-installable-app.md`](../../docs/proposals/backlog/user-installable-app.md) carries the verified capability matrix (62 claims checked against the raw Discord docs source and the installed discord.js typings), the hard limits, where the code stands, twenty-plus opportunities grouped into waves, what comparable apps do, and the build shape. Read that doc first; this entry is the queue pointer.

**The three facts that shape everything**: no per-character webhook identity outside installed servers (embeds carry the character); at most five follow-up messages per interaction there (a Continue button is a fresh interaction); the app receives interactions only — no message events, no channel reads — so the character can never speak first and only ever sees command arguments and context-menu targets.

### Phase 0 — prerequisites (NEXT when picked up)

- [ ] Manual probe on dev with a throwaway app: are follow-ups still forced ephemeral in DMs (a documented 2024 preview limitation the GA note never retracted)? Is `interaction.channel` null in a group DM without `Partials.Channel`?
- [x] Owner rulings (2026-09-17, recorded in the proposal § 7): spend = the ordinary policy everywhere; capture = as much as allowed within hard policy; consistency = the same rules anywhere the bot is used, nothing DM-unique; parity = as much DM/non-DM feature parity as the platform allows. Per-context persona switching stays open. The embed-in-bot-DMs question is TASK-1003.
- [ ] `defineCommand` gains `userInstallable` (default off) driving `setIntegrationTypes` + `setContexts` at registration; Developer Portal user-install context enabled; re-register.

### Phase 1 — portable data commands (ephemeral everywhere)

- [ ] Flag on: `/memory`, `/settings` (incl. data export/delete), `/persona`, `/character`, `/history`, `/inspect`, `/notifications`, `/feedback`, `/shapes`. A `SurfaceKind` derived from `interaction.context` + `authorizingIntegrationOwners`, threaded into deferral and the environment builder (group DM gets its own arm). Privacy-policy sentence.

### Phase 2 — a character in a DM with a friend / group DM (gated on Phase 0's probe + rulings)

- [ ] Interaction-scoped sender: embed identity, chunking bounded by the follow-up budget, Continue button, optional voice-message TTS. Consent card on first summon (only the other recipient's click enables). History keyed by the DM channel id (already the keying). Whisper (ephemeral) mode. Image input via an attachment option, quota keyed on user.

### Phase 3 — context-menu commands (gated on the third-party-content ruling)

- [ ] "Ask my character about this message"; "Remember this" if allowed; in-character ghostwriting with an ephemeral preview. Lives naturally beside `docs/proposals/backlog/message-actions.md`.

**Related**: `doc-104` (persisted channel names — a group-DM `/chat` is another consumer); `doc-86` (character-initiated messages — explicitly impossible on this surface, which is worth knowing when that theme is designed).
