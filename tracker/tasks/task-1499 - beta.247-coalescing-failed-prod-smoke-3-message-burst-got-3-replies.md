---
id: TASK-1499
title: 'beta.247 coalescing failed prod smoke: 3-message burst got 3 replies'
status: Done
assignee: []
created_date: '2026-11-21T19:23:00Z'
updated_date: '2026-11-22T17:14:00Z'
labels:
  - area:bot-client
  - size:M
  - state:observable
dependencies: []
priority: high
ordinal: 1499000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod smoke of #2769 burst coalescing failed (Lila 2026-11-21 14:22 EST, #cold-ai, character COLD, model claude-haiku-5.5 via OpenRouter). She sent test 1, test 2, test 3 in quick succession before any reply; COLD posted three separate replies, each aware of all three messages (one listed them as test 1, test 3, test 2). Expected: one reply to the newest.
What: diagnose from prod bot-client logs around 19:22Z (look for CoalescingHoldRegistry lines: Releasing coalesced survivor trigger, hold deadline, holdability rejections). Unverified hypotheses: in-flight entry created after the enqueue await so racing triggers all miss it; multiple bot-client replicas (registry is in-memory); channel or trigger not classified holdable.
Acceptance: root cause named with a log line; regression test at the seam; prod re-smoke passes.

Log read 2026-11-21 (prod bot-client, single host b136112bdf7a, so the multi-replica hypothesis is out; channel 1374589433671581736, personality c0b36b1b):
- msg1 1573780588576514139: trigger 19:22:11.88, job llm-328c submitted 19:22:15.21, completed 19:22:18.21 (3s generation).
- msg2 1573780606397972501: trigger 19:22:16.07 (while llm-328c was in flight). NO Held line; submitted its own job llm-63b6 at 19:22:22.25.
- msg3 1573780612135919737: trigger 19:22:17.39. "Held activation trigger behind in-flight generation" at 19:22:20.04 with awaitedJobId=null, i.e. behind msg2's entry, created before msg2's job existed. Released on completion of llm-63b6 at 19:22:24.66 (skippedCount=0), its own job llm-423d replied.
Observed: the hold decision is logged 2.6s after the trigger (after history fetch, link resolution and the reference crawl), not at trigger time. Inference (not yet confirmed in code): msg1's in-flight window ended at 19:22:18.21, before msg2's hold check ran, so msg2 saw no entry and became a new in-flight generation; the hold therefore only catches messages whose context build finishes before the in-flight job completes. A fast model (3s) makes the window nearly empty. Fix direction to evaluate: decide holdability and register or join the in-flight entry at trigger resolution, before context building.
Intended count (Lila ruling 2026-11-21): TWO replies. The in-flight reply to msg1 completes, msg2 is skipped, one survivor reply goes to msg3. Never cancel or discard an in-flight generation. The regression test and the re-smoke assert two; the beta.247 smoke text (CURRENT.md) saying ONE reply was wrong and needs correcting.

Fix merged to develop 2026-11-21 in PR #2780 (061686496): confirmed root cause in code+logs — msg2 (19:22:16.068Z) and msg3 (19:22:17.391Z) BOTH saw msg1's in-flight entry immediately and entered saveUserMessage, which awaited INTERVALS.EMBED_PROCESSING_DELAY (2.5s) before setting entry.newest. When msg1 delivered at 19:22:18.629Z, entry.newest was still null so releaseCycle deleted the entry; 130ms later msg2 saw undefined and submitted reply #2, and msg3 held behind msg2 for reply #3. CoalescingHoldRegistry now tracks pendingSaves synchronously before awaiting saveUserMessage and drains them under a bounded 15s cutoff on release; red-first regression tests added in CoalescingHoldRegistry.test.ts and MultiTagCoordinator.test.ts. Remaining acceptance: prod re-smoke after the next release deploys.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prod re-smoke PASSED 2026-11-22 11:30 EST (Lila, #cold-ai, relayed by the Deck session from her screenshot): 4 quick plain-text messages sent mid-reply produced 2 COLD replies (the in-flight one plus one survivor), matching the two-reply ruling. Acceptance met.
<!-- SECTION:NOTES:END -->
