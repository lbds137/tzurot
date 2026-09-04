---
id: TASK-725
title: >-
  Flag-on real-messages render runs 3x per shipped entry (measure, re-measure,
  ship)
status: To Do
assignee: []
created_date: '2026-08-22 11:11'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 725000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2181 review (round 2, LOW/efficiency, non-blocking; also flagged in round 1). Flag-on, each selected history entry is rendered three times: renderHistoryEntryForMeasure during selection (via measureHistoryEntryRealTokens in ContextWindowManager.selectCurrentChannelEntries), buildRealMessages in ContextWindowManager.measureRealMessagesTokens for exact historyTokensUsed, and buildRealMessages again in ContentBudgetManager.allocate to build the shipped messages. All three sites carry comments justifying the trade (deterministic, cheap string work over a bounded window).

Fix shape: thread the built messages instead of rebuilding — e.g. selectAndSerializeHistory returns the flag-on BaseMessage array alongside selectedEntries (or PreselectedHistory carries it), allocate consumes it directly. Requires care that the measure and the shipped build cannot drift (the whole reason the re-measure exists).

Acceptance: at most one buildRealMessages pass per turn flag-on, with a seam test pinning that the measured and shipped forms remain identical. Promote when: profiling shows render cost matters, or history windows grow well past the current ~100-entry cap.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost it prevents (redundant string-building work per turn, deliberately traded for determinism today). `buildRealMessages` is still called from at least two independent production sites (`ContextWindowManager.ts:545` for measurement and `shippedHistoryMessages.ts:93` for the shipped build) rather than one threaded-through build; could not fully confirm whether this is still 3 sites or has already been trimmed to 2, so treating the "thread the built messages" acceptance criterion as unmet. Evidence: `grep -n "buildRealMessages(" services/ai-worker/src/services/context/ContextWindowManager.ts services/ai-worker/src/services/context/shippedHistoryMessages.ts` → two separate non-test call sites remain.
---
<!-- COMMENTS:END -->
