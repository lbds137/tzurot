---
id: TASK-619
title: Verify userMessageTime equals the Discord post time on every producer path
status: Done
assignee: []
created_date: '2026-08-15 15:48'
updated_date: '2026-08-15 19:19'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 619000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: historyReasoning.ts bridgeFromTriggerMessage pairs a trigger message to its reply by EXACT timestamp equality, userRow.createdAt + ASSISTANT_ROW_OFFSET_MS, matching the offset the persist handler uses to derive the assistant row. That pairing is correct only if userMessageTime is genuinely the Discord post time, i.e. the same instant the user row was stamped with. That equivalence is assumed, not verified.

CORRECTED SCOPE: an earlier version of this task described a range scan (createdAt gt, orderBy asc) and a race where a later reply could be returned instead of 404. That shipped differently. PR 2105 replaced the range scan with the exact equality above precisely to remove that class, so there is no race left to fix and no heuristic left to replace. What survives is only the unverified premise.

It also recorded a reasoning error worth naming, since it was the argument for NOT doing the exact match: it claimed an exact lookup that misses is worse than a heuristic, trading a transient wrong answer for a durable missing one. That compared exact-miss against heuristic-CORRECT. The real comparison is exact-miss against heuristic-WRONG: a range scan answers a click whose paired reply was never persisted with some unrelated turn reasoning, rendered under the wrong message. A 404 puts the user where they were before the bridge existed. Fail-safe beats fail-wrong, which is why the exactness shipped without waiting for this sweep.

Consequence today: if userMessageTime diverges from the post time on some path, the bridge MISSES and the user sees the ordinary not-found. No wrong answer, no leak, just a feature that quietly does not work for whichever path diverges. (Originally filed medium on that reasoning; raised to high once the probe below showed the divergence covers effectively ALL traffic, not an edge path.)

Fix shape: sweep every producer that supplies userMessageTime to saveAssistantMessage and confirm each is the Discord post time. Known producers to check by name: the job context path through MessageHandler, MultiTagRecovery rebuilding it from a serialized snapshot, and multiTagCoordinatorHelpers. Then either assert the invariant with a test per path, or document the divergent path and decide whether the bridge should handle it.

Acceptance: every userMessageTime producer is enumerated and each is shown to be the Discord post time (or the divergence is named); the bridge's docstring stops saying the equivalence is unverified, or says exactly which path is exempt.

ANSWERED EMPIRICALLY 2026-08-15 (prod DB probe, 816 user turns over 7 days): the premise is FALSE on effectively every live path — 0/816 pairs sit at exactly +1ms; real deltas run 62ms-3s. Producers: characterTurn.ts:554 uses anchorMessage.createdAt (post time, but a minority path; weigh-in mode deliberately uses new Date()); MultiTagCoordinator.ts:166 and PersonalityChatManager.ts:182 both use new Date() at coordination time — and multi-tag is the dominant path. User rows carry message.createdAt, so the two sides never agree. The bridge is therefore DEAD CODE in practice (fail-safe: always not-found, never wrong), and the ASSISTANT_ROW_OFFSET_MS doc comment in common-types/constants/message.ts wrongly implies the reader can pair by adding the offset to the stored user row.

Remaining decision (design, not sweep): (a) fix the bridge to nearest-following-assistant-within-a-bounded-window (data: 815/816 pair within 60s; wrong-answer risk bounded by the window), (b) drop the trigger-message bridge entirely (the primary reply-message-id lookup is how the feature is actually used), or (c) align producers to anchorMessage.createdAt — deepest fix but touches ResponseOrderingService ordering semantics and the weigh-in collision-avoidance divergence, so it is its own unit. Whichever lands must also correct the constant's doc comment.
<!-- SECTION:DESCRIPTION:END -->
