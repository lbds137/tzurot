---
id: TASK-710
title: >-
  Extract the private-thread membership gate shared by the two viewer-access
  checks
status: Done
assignee: []
created_date: '2026-08-21 01:19'
updated_date: '2026-08-21 14:39'
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
SHIPPED 2026-08-21 - PR 2169, merged. All three acceptance clauses met.

1. "one exported helper with its own tests including a non-member canary" - MET. satisfiesPrivateThreadMembership in services/bot-client/src/utils/threadAccess.ts, 5 tests. The two skip paths assert members.fetch was NEVER called, so they pin the skip rather than only the result. Canaried: inverting the try/catch reddened 6 tests across all three files.
2. "both call sites converted" - MET, behaviour identical at both, and neither site's existing tests were edited - they are the canary. Review independently re-ran the third-site sweep and confirmed no others exist.
3. "a comment at the helper naming why ViewChannel alone is insufficient" - MET, plus the FOLD IN WHEN CONSOLIDATING item above (the catch cannot distinguish a non-member from a bot-side Manage Threads gap) is in the docstring.

ONE THING THE TASK DID NOT ANTICIPATE, recorded because it outlives this task. The gate treats a resolved members.fetch as proof of membership, and that turned out to be TWO claims rather than one. Probed against the shipped discord.js 14.27.0 typings: the single-snowflake overload resolves Promise<ThreadMember> with no | null, so the no-null half is VERIFIED. The throws-for-a-non-member half is NOT probed - it was inherited from what the original call sites were written against - and it is the half the gate rests on, because a non-member fetch that RESOLVED would return true and open the gate. The docstring now separates the two and names that as the direction to watch. A live probe against a real private thread would settle it; nothing here does.

Disposition on the two review observations, both correct-as-is with reasons rather than deferred: the throws-ambiguity denies in the safe direction (it costs a channel NAME, never grants access) and telling the cases apart would mean branching on an unprobed Discord error contract with no operational need; the cast asymmetry between the two call sites is inherent to how each narrows its own input, and forcing symmetry would mean restructuring narrowing in a security path this PR had no reason to touch. The asymmetry note is carried into the TASK-712 spec, since 712 is the third consumer.
<!-- SECTION:DESCRIPTION:END -->
