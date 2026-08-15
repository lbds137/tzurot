---
id: TASK-619
title: Verify userMessageTime equals the Discord post time on every producer path
status: To Do
assignee: []
created_date: '2026-08-15 15:48'
updated_date: '2026-08-15 17:08'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 619000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: historyReasoning.ts bridgeFromTriggerMessage pairs a trigger message to its reply by EXACT timestamp equality, userRow.createdAt + ASSISTANT_ROW_OFFSET_MS, matching the offset the persist handler uses to derive the assistant row. That pairing is correct only if userMessageTime is genuinely the Discord post time, i.e. the same instant the user row was stamped with. That equivalence is assumed, not verified.

CORRECTED SCOPE: an earlier version of this task described a range scan (createdAt gt, orderBy asc) and a race where a later reply could be returned instead of 404. That shipped differently. PR 2105 replaced the range scan with the exact equality above precisely to remove that class, so there is no race left to fix and no heuristic left to replace. What survives is only the unverified premise.

It also recorded a reasoning error worth naming, since it was the argument for NOT doing the exact match: it claimed an exact lookup that misses is worse than a heuristic, trading a transient wrong answer for a durable missing one. That compared exact-miss against heuristic-CORRECT. The real comparison is exact-miss against heuristic-WRONG: a range scan answers a click whose paired reply was never persisted with some unrelated turn reasoning, rendered under the wrong message. A 404 puts the user where they were before the bridge existed. Fail-safe beats fail-wrong, which is why the exactness shipped without waiting for this sweep.

Consequence today: if userMessageTime diverges from the post time on some path, the bridge MISSES and the user sees the ordinary not-found. No wrong answer, no leak, just a feature that quietly does not work for whichever path diverges. That is why this is medium and not high.

Fix shape: sweep every producer that supplies userMessageTime to saveAssistantMessage and confirm each is the Discord post time. Known producers to check by name: the job context path through MessageHandler, MultiTagRecovery rebuilding it from a serialized snapshot, and multiTagCoordinatorHelpers. Then either assert the invariant with a test per path, or document the divergent path and decide whether the bridge should handle it.

Acceptance: every userMessageTime producer is enumerated and each is shown to be the Discord post time (or the divergence is named); the bridge's docstring stops saying the equivalence is unverified, or says exactly which path is exempt.
<!-- SECTION:DESCRIPTION:END -->
