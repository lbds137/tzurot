---
id: TASK-1461
title: >-
  Tear down the phantom hold cycle when a refused fan-out never consumes its
  handoff
status: To Do
assignee: []
created_date: '2026-11-19T06:40:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1461000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 PR 2769 round-7 #3. beginSurvivorCycle creates the in-flight entry before the detached fan-out; if the fan-out refuses (shuttingDown) or early-returns without submitting, the finally clears only the handoff and the entry holds the pair until HOLD_DEADLINE_MS behind a job that does not exist. Fix: in the finally, when the handoff was unconsumed and the entry still belongs to that cycleId with awaitedJobId null, run the releaseCycle teardown or promotion so the cycle idles or promotes instead of blocking. Also fix the existing unconsumed-handoff test, which currently pins the stall (next trigger held behind a phantom) as the expected outcome. Practical impact today is small: the realistic trigger is shutdown, where clear() follows. Acceptance: a refused fan-out tears down or promotes; the updated test pins the new outcome.
<!-- SECTION:DESCRIPTION:END -->
