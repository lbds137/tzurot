---
id: TASK-710
title: >-
  Extract the private-thread membership gate shared by the two viewer-access
  checks
status: To Do
assignee: []
created_date: '2026-08-21 01:19'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 710000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2167 review found that resolveOriginChannelName had the private-thread hole that LinkExtractor.verifyInvokerCanAccessSource had already found and fixed. The second site was written as a partial copy of the first and silently dropped its thread half. Both are correct now; nothing stops a third site repeating it.

The rule is non-obvious and that is the whole problem: threads carry no permission overwrites of their own, so channel.permissionsFor resolves the PARENT channel overwrites, while a private thread layers an explicit member list on top. ViewChannel on the parent therefore does NOT imply thread access, and someone removed from a private thread usually keeps parent ViewChannel. Nothing about the permissionsFor call site hints at this.

Class enumeration (grep permissionsFor across services/ and packages/, non-test, 2026-08-20) - exactly TWO viewer-access checks exist:
1. services/bot-client/src/handlers/references/LinkExtractor.ts:308-343 - verifyInvokerCanAccessSource. Takes a GuildMember, requires ViewChannel + ReadMessageHistory, then the private-thread members.fetch. Correct.
2. services/bot-client/src/utils/forwardedMessageUtils.ts:415-427 - resolveOriginChannelName. Takes a raw snowflake, requires ViewChannel, then the same members.fetch. Correct as of PR 2167 round 2.
No third site. The only other permissionsFor hit is a test mock.

Fix shape: extract the thread half alone, not the whole check - the two differ legitimately in viewer type (GuildMember vs snowflake) and in strictness (the link path also needs ReadMessageHistory), so only the membership sub-check is common. Something like satisfiesPrivateThreadMembership(channel, viewerId): Promise<boolean>, fail-closed on throw, skipping public and announcement threads. No callbacks, one cohesive question, so the 2-callback ceiling does not apply. Convert both sites to call it.

Why not in PR 2167: consolidating means editing LinkExtractor, a security path that PR has no other reason to touch. Risky breadth, deferred deliberately rather than for convenience.

Acceptance: one exported helper with its own tests including a non-member canary; both call sites converted; a comment at the helper naming why ViewChannel alone is insufficient so the next reader does not re-derive it.
<!-- SECTION:DESCRIPTION:END -->
