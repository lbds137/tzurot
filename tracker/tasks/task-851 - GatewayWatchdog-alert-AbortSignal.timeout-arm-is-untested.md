---
id: TASK-851
title: GatewayWatchdog alert AbortSignal.timeout arm is untested
status: To Do
assignee: []
created_date: '2026-09-01 13:30'
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
