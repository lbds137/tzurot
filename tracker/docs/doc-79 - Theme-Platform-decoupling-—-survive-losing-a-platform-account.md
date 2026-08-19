---
id: doc-79
title: 'Theme: Platform decoupling — survive losing a platform account'
type: other
created_date: '2026-08-19 13:32'
---

_Focus: reaching your own personas must not depend on any single platform's account standing._

Full planning brief (unscrubbed, with the incident that prompted it) is in
`docs/local/PLATFORM_DECOUPLING_BRIEF.md` — gitignored, because the trigger is
personal. This doc carries the technical substance only.

## Verified against develop, 2026-08-19

The brief was written against `main` @ beta.204 and asks for re-verification.
Checked:

- `@db.VarChar(20)` in prisma/schema.prisma: **29** — matches.
- `User.discordId` is `String @unique @db.VarChar(20)`, **required** — matches.
  A web-only or Matrix-only user cannot exist today.
- api-gateway identity is the `X-User-Id` header, trusted as-is
  (AuthMiddleware.ts:105); owner is string equality against `BOT_OWNER_ID`, a
  Discord id (:53). No end-user auth exists anywhere in the service — matches,
  and this is the largest gap.
- **Corrected:** the brief says 25 common-types files import discord.js. 25
  files MENTION it; **5 import it, and 2 of those are tests.** The production
  burn-down list is three files: `types/discord-types.ts`,
  `utils/typedOptions.ts`, `utils/ownerMiddleware.ts`. Audit task 1 is much
  smaller than scoped.

## Phase 0 — the precondition, not a parallel workstream

Auth before exposure, and they are not the same task as "build a web UI".
Today ANY request that sets `X-User-Id: <id>` IS that user. That is safe only
while bot-client is the sole caller on a private network. The moment the
gateway is reachable from a browser, that header is a total-compromise bug —
so a real session/token layer resolving to an internal user UUID must land
BEFORE any public route tree mounts, and the CORS/error-verbosity/route-mount
review in the brief's risk 6 belongs here rather than at the end.

## Phase 1 — solo web fallback

Minimal chat frontend, one user, fresh conversations only (no Discord history
binding yet). Proves the job pipeline is genuinely platform-free — ai-worker
already imports no discord.js. Not Discord OAuth: the whole point is surviving
Discord account loss.

## Phase 2 — platform-neutral identity and conversation keys

`UserIdentity(platform, externalId) -> userId` and
`Conversation` + `ConversationBinding`, dual-write then backfill then read-flip.
Index re-derivation on ConversationHistory is the risky part; the schema
comments there document measured planner behaviour and must not be winged.

## Phase 3 — account continuity (owner request, 2026-08-19)

"I should be able to designate my alt as equivalent to my main account."

THIS IS THE SAME TABLE as Phase 2's `UserIdentity`: several rows sharing one
`userId`, differing only in `externalId`, with `platform='discord'` on each.
No separate linkage mechanism is needed — but four things do not fall out of
it, and each is a decision rather than an implementation detail:

1. **Equivalence and independent verification are opposite requirements.** The
   owner wants an alt for independent verification AND wants alts to carry
   their data. A fully equivalent alt sees the same personas, memories and
   configs, so it cannot verify anything independently. This needs a per-link
   MODE, not one global setting: `equivalent` (shares personas/memories/
   entitlements) vs `same-human-distinct-space` (linked for retention and
   abuse purposes, separate persona and memory space) — the second is the
   testing alt.
2. **Privilege must not inherit.** Owner is currently string equality against
   one Discord id. Moving that check to the internal user UUID would silently
   make every linked identity an owner. Privilege belongs to the IDENTITY,
   defaulting off for a newly linked one — which also delivers the "alt behaves
   like an ordinary user" property the testing case wants.
3. **Linking is account-takeover-adjacent.** A one-sided declaration means
   compromising either account yields both. Require proof of control from BOTH
   sides, and notify the existing identities on a successful link.
4. **Denylist and retention must evaluate at the User level once linked**, or
   linking becomes a ban-evasion mechanism. Fail closed, consistent with the
   rest of the codebase.

## Not started

Deliberately parked until beta.205 ships. Nothing here is urgent enough to
interrupt a partially-finished theme.
