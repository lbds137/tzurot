---
id: TASK-715
title: Hoist the forward access gate out of the per-snapshot loop
status: Done
assignee: []
created_date: '2026-08-21 15:34'
updated_date: '2026-08-21 16:09'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 715000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review finding on PR 2170 (Low, non-blocking), deferred there with a stated technical reason rather than fixed in-round.

The redundancy, verified: ReferenceFormatter.appendForwardedSnapshots calls SnapshotFormatter.formatSnapshot once per entry in message.messageSnapshots, and formatSnapshot calls buildForwardMarker(forwardedFrom) every time. The marker depends only on forwardedFrom.reference.channelId and forwardedFrom.author.id, never on the snapshot, so it is invariant across the loop. For a forward with N snapshots the full access gate is evaluated N times, and on the private-thread branch each evaluation can reach channel.members.fetch. Before PR 2170 that repetition was a cheap synchronous property read; it is now async and can carry I/O.

NOT ESTABLISHED, in either direction: whether N greater than 1 is reachable. discord-api-types payloads/v10/message.d.ts:246 declares message_snapshots as a bare APIMessageSnapshot array with no cardinality note, and discord.js exposes it as a Collection. The reviewer described forwards as almost always single-snapshot, which is a prior and not evidence. At N equals 1 the redundancy costs nothing, so the whole value of this task rests on that unanswered question.

Why it was NOT fixed in the review round, which is the part worth not re-deriving: the correct shape is to compute the marker once in appendForwardedSnapshots and pass it in, which leaves formatSnapshot with no await. eslint.config.js sets typescript-eslint require-await to error, so formatSnapshot must then revert to sync, and await-thenable is also an error, so roughly 27 test call sites lose their await. The gate tests should also move from formatSnapshot level down to buildForwardMarker level, which is better isolation but a real restructure. That is a coherent refactor with its own review surface, not a fixup appended to a round-one review.

Fix shape: make buildForwardMarker public on SnapshotFormatter, compute it once before the for-of in appendForwardedSnapshots, pass it to formatSnapshot as a required parameter, revert formatSnapshot to sync, drop the now-invalid awaits, and re-point the six gate tests at buildForwardMarker directly. ReferenceFormatter.format stays async.

Acceptance: the gate is evaluated exactly once per forwarded MESSAGE regardless of snapshot count, pinned by a test that counts permissionsFor invocations across a multi-snapshot forward; the existing sequential-numbering guarantee still holds and its structural test still passes.
SHIPPED IN THE PR THAT FILED IT (#2170), 2026-08-21. Filed as a deferral at review round 1,
then implemented at round 3 when the reviewer escalated the finding to Medium on its third raise.

Reversing the deferral was the right call and the reasoning is worth keeping, because the original
argument was not wrong so much as incomplete: it costed only the hoist-and-thread shape and never
costed the memoize shape the reviewer had also offered. Once the work was measured rather than
estimated it came to roughly 100 lines, entirely mechanical, with no design risk.

Two things fell out that the task did not anticipate:

1. The hoist REMOVED a hazard rather than merely optimising. With the marker resolved before the
   loop, the loop body has no await left, so the shared-FormatState numbering race that the
   sequential for-of was protecting against is now structurally impossible rather than avoided by
   discipline. The structural sequencing test was replaced by one asserting the marker resolves
   exactly once per forwarded message and that every snapshot receives the same value.

2. formatSnapshot reverted to sync as predicted, and the require-await / await-thenable cascade
   landed as predicted, but it was 8 unused fixtures and roughly 27 awaits rather than anything
   subtle. The gate tests moved down to buildForwardMarker, which is better isolation than the
   formatSnapshot-level tests they replaced.

The open question the task said its value rested on -- whether a forward ever carries more than one
snapshot -- is still unanswered, and no longer matters here: the fix is correct at N equals 1 too,
since it makes per-message work happen once per message.
<!-- SECTION:DESCRIPTION:END -->
