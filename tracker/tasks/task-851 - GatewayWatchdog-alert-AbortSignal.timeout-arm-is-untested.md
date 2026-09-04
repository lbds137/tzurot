---
id: TASK-851
title: GatewayWatchdog alert AbortSignal.timeout arm is untested
status: To Do
assignee: []
created_date: '2026-09-01 13:30'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 851000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: createAlertSender bounds the owner-alert webhook POST with AbortSignal.timeout(2500) (services/bot-client/src/services/GatewayWatchdog.ts, ALERT_TIMEOUT_MS). The never-rejects and non-OK paths are unit-tested, but the timeout arm itself is not - driving AbortSignal.timeout under vitest fake timers is impractical, so the code comment discloses it as unverified. claude-review round 3 on PR 2286 asked for this to be tracked so the gap is not later assumed covered.

Fix shape: a real-timer integration-style test (short custom timeout, a fetchFn that hangs, assert the POST aborts and exit still fires within bound), or a one-off dev smoke with a blackholed webhook URL. Either closes it; record which.

Acceptance: the timeout arm has a test or a recorded runtime verification, and the hedge in the code comment is updated to cite it.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed still unverified — the code comment explicitly discloses the timeout arm as unverified by any test. Evidence: `sed -n '220,245p' services/bot-client/src/services/GatewayWatchdog.ts` → comment: "the timeout arm is unverified here," `AbortSignal.timeout(WATCHDOG_THRESHOLDS.ALERT_TIMEOUT_MS)` unchanged.
---
<!-- COMMENTS:END -->
