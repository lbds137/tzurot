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

FOLD IN WHEN CONSOLIDATING (PR 2167 round 6, non-blocking, deliberately not fixed there): the catch around thread.members.fetch cannot distinguish "the forwarder is not a member" from "the BOT lacks permission to list this thread's members" - a missing Manage Threads on our side rejects for a reason that has nothing to do with the forwarder. Both outcomes omit the channel name, so the behaviour is a false NEGATIVE and consistent with the fail-closed posture; it is not a correctness bug.

What it does mean is that the failure mode is broader than the name suggests, and the consolidated helper is where that belongs - either in its docstring, or as a logged distinction if the two cases ever need telling apart operationally. LinkExtractor's copy has the identical property and the identical silence about it.

Note the existing comment at the fetch is accurate as written ("reaching the next line is itself the proof of membership") - a successful fetch does prove membership. It is the CONVERSE that does not hold, and nothing currently claims it does. So this is an addition to make, not a correction.
<!-- SECTION:DESCRIPTION:END -->
