---
id: TASK-529
title: 'Channel-tier settings are defaults, not policy - moderators cannot enforce'
status: To Do
assignee: []
created_date: '2026-08-11 18:41'
labels:
  - 'area:common-types'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 529000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by a moderator ask (Xeo, Discord #general 2026-08-11: can the GLOBAL memory setting be changed) read through the moderator lens the owner supplied - most of the product is built user-level, but this request is server-moderation.

Verified in packages/config-resolver/src/ConfigCascadeResolver.ts:5-14. The cascade is: hardcoded < admin < personality < CHANNEL < user-default < user+personality, higher tiers overriding lower per field. Tiers 4 and 5 are the USER tiers, so a channel-tier value set by a moderator is overridden by any user who has set the same field for themselves. A moderator who sets a channel memory limit has set a default for users who never touched it, not a ceiling - and nothing in the UI says so (TASK-527 covers the legibility half; this is the capability half).

What, if the owner wants it: an enforce direction in the cascade. Options sketched, none chosen - a per-field lock on the channel tier that terminates resolution (the NULL_TERMINAL_FIELDS mechanism in configOverrides.ts is a precedent for a tier stopping fall-through); or a separate ceiling that clamps rather than replaces, which composes better for numeric fields like memoryLimit and maxMessages than a boolean lock does.

Owner decision first, because this is product taste with a moderation dimension: does a server moderator get authority over settings a user set for themselves, in that server channel only. There is a real argument for no - the user tier represents the human own preference and their conversations are their own. Filed to make the gap visible, not to advocate for it.

THEME: member of doc-75 (Guild / Server Management), Phase 1 - and the decision this task asks for is the theme cross-cutting question, so answering it unblocks Phase 2 as well. Owner framing 2026-08-11: most of the product is user-level; this is the moderator level.

Acceptance: a recorded decision. If yes, the enforce mechanism plus the dashboard wording that explains it; if no, the answer to why moderators cannot enforce lives somewhere a user can read.
<!-- SECTION:DESCRIPTION:END -->
