---
id: TASK-648
title: Bot/webhook identities are provisioned as real user rows
status: To Do
assignee: []
created_date: '2026-08-18 00:01'
labels:
  - 'area:identity'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 648000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod has at least TWO user rows that are not people -- discord_id 1452360456152027196 username "Dionysus | שבת" (created 2026-02-18T08:39:47.359Z) and 1493811801983287316 username "Azazel · שבת" (created 2026-05-27T00:17:57.387Z). Both are CHARACTER WEBHOOK display names (character name + the bot server-nickname suffix; the separator differs because the webhook naming convention changed between those dates). Both have created_at == last_active_at to the millisecond, i.e. one ingest and never touched again. They inflate the userbase count (208) and one surfaced in the retention purge-eligible cohort, where the owner spotted it.

CONFIRMED by reading the code (not assumed):
- The choke point IS guarded and always was: UserService.getOrCreateUsersInBatch filters on !u.isBot (packages/identity/src/UserService.ts:622), and getOrCreateUser itself returns null when isBot === true. Verified the same guard existed at BOTH row-creation dates via git show at commits before 2026-02-18 and 2026-05-27, so this is NOT a case of a guard added later.
- Therefore the rows were created with isBot FALSE or ABSENT. ContextAssembler.ts:523 reads isBot: u.isBot ?? false, so an OMITTED flag reads as human -- absence is indistinguishable from a real human at that seam.
- A REAL defect exists at services/bot-client/src/services/channelFetcher/ParticipantContextCollector.ts:103 -- collectReactorUsers hardcodes isBot: false for every reactor, so any BOT that reacts to a message is provisioned as a user. That is a genuine hole regardless of whether it produced these two rows.

OPEN, do not guess: which path actually created these two rows is NOT established. Reactors are users/bots and webhooks cannot add reactions, so the hardcoded reactor flag does not obviously explain a WEBHOOK display name. Other candidates to trace: RawEnvelopeBuilder.ts:181 uses presence-encoding (...(u.bot && { isBot: true })) so a falsy/undefined u.bot omits the flag; and any path that reconstructs participants from STORED history rather than a live discord.js Message would have no author.bot to read.

Also note the detection limit: the two rows were found by grepping usernames for the שבת suffix, which is this servers bot nickname. Webhooks in a server where the bot has a different nickname would not match, so TWO IS A FLOOR, NOT A TOTAL.

Fix shape: (1) trace the actual creation path for a webhook-authored extended-context participant and fix the isBot derivation at its source; (2) fix the reactor hardcode at ParticipantContextCollector.ts:103 regardless; (3) consider making absence FAIL CLOSED at the ContextAssembler seam (treat missing isBot as unknown-and-skip rather than human) so a future omission cannot silently provision again; (4) clean up the existing phantom rows once no path can recreate them.

Acceptance: a webhook-authored extended-context message and a bot reactor both leave the users table unchanged, pinned by tests; a prod scan finds no user row whose username matches the bot webhook naming shape.
<!-- SECTION:DESCRIPTION:END -->
