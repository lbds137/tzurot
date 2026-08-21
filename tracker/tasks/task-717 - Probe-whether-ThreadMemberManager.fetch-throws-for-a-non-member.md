---
id: TASK-717
title: Probe whether ThreadMemberManager.fetch throws for a non-member
status: Done
assignee: []
created_date: '2026-08-21 16:53'
updated_date: '2026-08-21 19:04'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 717000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2170 round 7 flagged that a third consumer now rests on this claim. It is the one unverified premise under every private-thread access gate we have, and it fails in the UNSAFE direction.

The claim, quoted from services/bot-client/src/utils/threadAccess.ts: a single-snowflake channel.members.fetch(viewerId) THROWS for a non-member rather than resolving. The docstring already marks it not independently probed and inherited from the behaviour the original call sites were written against.

Why it matters more than an ordinary unverified claim: satisfiesPrivateThreadMembership treats a successful fetch as proof of membership. If a non-member fetch ever RESOLVES, the function returns true and the gate OPENS. Every other failure mode in this area denies; this one grants. The sibling claim in the same docstring -- that the overload returns Promise<ThreadMember> with no null -- IS verified against the shipped 14.27.0 typings, so the two must not be conflated.

Blast radius, all three sharing the single premise: LinkExtractor.verifyInvokerCanAccessSource (gates expanding message CONTENT), forwardedMessageUtils.resolveOriginChannelName (gates naming a channel), and SnapshotFormatter.buildForwardMarker (same, on the live-reference path, added by PR 2170). If the probe comes back wrong, all three need revisiting together rather than one at a time.

Why this is state:owner rather than state:ready: it cannot be settled by reading types or by a unit test, because it is a question about what the Discord API does at runtime. It needs a live call against a real private thread with a real non-member id -- a dev session with the owner driving, or a one-commit debug probe on a path that reaches a private thread. A mocked test would only re-encode the assumption being questioned.

Acceptance: the throws-for-non-member behaviour is confirmed or refuted by a runtime observation; the threadAccess docstring is updated to say which, citing the observation; and if refuted, all three call sites are corrected together in one change.

Resolution: CONFIRMED, by the live probe this task called for (dev bot, owner-staged private thread, discord.js 14.27.0). The non-member fetch threw DiscordAPIError[10007] Unknown Member (HTTP 404) -- identically on an immediate retry, so no cache layer converts the miss into a resolve -- while the member fetch resolved a ThreadMember. The threadAccess docstring now cites the observation (PR #2173). Clause 3 (correct all three call sites) is N/A: the claim held.
<!-- SECTION:DESCRIPTION:END -->
