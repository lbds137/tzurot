---
id: TASK-822
title: >-
  Retry ladder worst case makes a user wait ~10 minutes before the fallback
  reply lands
status: To Do
assignee: []
created_date: '2026-08-29 17:43'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 822000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed in prod 2026-08-29, first sighting of the enriched ops-alert embed (#2245, shipped beta.210). Alert: "timeout (rescued)" — outcome "rescued — turn succeeded via fallback", personality Alona, model z-ai/glm-5.3-flash to openrouter/free, provider openrouter, requestId 0267bb14-3294-49d6-82b6-ec2487b2c35a, Duration 610942ms.

610942ms is 10.2 MINUTES of user-visible wait before the reply arrived. The arithmetic is consistent with the design rather than a defect: TIMEOUTS.LLM_PER_ATTEMPT is 180000ms (packages/common-types/src/constants/timing.ts:37), so three attempts timing out at 3 min each is ~9 min, plus the successful fallback attempt lands near 610s. Nothing malfunctioned — the ladder did what it is configured to do, and the turn DID succeed.

The question is product taste, which is why this is filed rather than fixed: how long should a user wait on a stalling provider before we stop retrying it and move on? Three full 180s attempts against a provider that is timing out (as opposed to erroring fast) buys little — a provider that has not answered in 180s is unlikely to answer on attempt 2 or 3 for the same reason — while costing the user the entire window.

MITIGATION ALREADY IN PLACE — owner correction 2026-08-29, verified in code: the wait is NOT silent. `JobTracker` posts a "taking longer" notification once a tracked job passes `TAKING_LONGER_NOTIFY_MS` (`services/bot-client/src/services/JobTracker.ts:83`, 5 minutes), guarded by `notificationSent` so it fires once, and `completeJob` deletes the notification when the real reply lands (JobTracker.ts:284-285). So the observed 10.2-minute case showed the user a wait notice at the ~5-minute mark. This LOWERS the severity materially: the open question is a wait-budget tuning call, not a silent-hang defect, and (d) accept-as-is is a genuinely reasonable answer. Recorded because the original filing overstated the user impact by omitting it.

Interaction worth noting: TASK-820 (typing indicator on rehydrated pickup) makes this MORE visible, not less. Once the indicator is correct, the user watches ten minutes of "typing" rather than ten minutes of nothing — though with the 5-minute notice above, they are at least told why. NOTE the untested seam between the two: a job REHYDRATED after a restart is re-tracked with a fresh `startTime`, so its taking-longer clock plausibly restarts from zero and the notice fires late (or not at all) relative to the user's real wait. Verify that when 820/821 are built; do not assume it either way.

Candidate directions, none chosen (owner call): (a) fewer attempts specifically for the TIMEOUT category, on the reasoning above, leaving other categories at the current count; (b) a shorter per-attempt timeout for timeout-prone routes; (c) advance to the fallback after the FIRST timeout rather than exhausting the ladder; (d) accept as-is and treat it as the cost of maximum success rate. Verify the current retry count and any per-category attempt logic before designing — the 3-attempt figure here is inferred from the duration arithmetic, NOT read from the retry config.

Acceptance: a deliberate owner decision on the timeout-path wait budget, and if a change is chosen, the worst-case wait is bounded to the agreed number with the fallback still reached.

Provenance: owner-approved filing 2026-08-29 ("we can file it").

Owner question: On the TIMEOUT path specifically, do we (a) cut the attempt count, (b) shorten the per-attempt timeout, (c) advance to the fallback after the first timeout, or (d) accept the current worst case as the cost of maximum success rate?
Recommendation: (a) fewer attempts for the TIMEOUT category only — the task's own reasoning is that a provider silent for 180s is unlikely to answer on attempt 2 or 3 for the same reason, so those attempts buy little while costing the user the whole window, and leaving other categories at the current count keeps the change narrow.

Decision 2026-09-02 (owner): measure first. The retry helper logs one line per attempt (retry.ts: `[Retry] <op> succeeded on attempt N` at info with durationMs; a warn per retryable failure with errorContext + attempt), but nothing aggregates them and the ops-alert embed fires only on rescued/failed turns, so attempt-2 successes are invisible there. Next step: query a window of prod logs for attempt-2/3 successes that followed a TIMEOUT-category failure, put the rate on this task; the cut-attempts change waits for that number. Trigger: the measured rate.
<!-- SECTION:DESCRIPTION:END -->
