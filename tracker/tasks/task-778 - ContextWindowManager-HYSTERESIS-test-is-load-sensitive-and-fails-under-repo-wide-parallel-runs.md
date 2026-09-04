---
id: TASK-778
title: >-
  ContextWindowManager HYSTERESIS test is load-sensitive and fails under
  repo-wide parallel runs
status: Done
assignee: []
created_date: '2026-08-26 23:25'
updated_date: '2026-09-04 16:41'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 778000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: src/services/context/ContextWindowManager.test.ts § HYSTERESIS / HEAD STABILITY fails intermittently during a repo-wide pnpm test, and passes standalone every time. Measured on 2026-08-26: 6725ms and FAILED inside the full turbo run, 1658ms and green when the file is run alone via npx vitest run from the package dir. The whole file is 33 tests in 3.31s standalone.

The signature is a timing ratio, not a logic error, so this is contention rather than a real defect: the assertion is about hysteresis across successive appends and the test is slow enough under parallel load to cross whatever bound it relies on. It cost real diagnosis time twice in one session, because a named test failing in an untouched package is indistinguishable from a regression until you run it standalone.

Also note the surrounding shape that makes it expensive: turbo cancels in-flight sibling tasks when one fails, so a single flaky file produces ELIFECYCLE lines for three or four packages with no summary output, which reads as a much bigger failure than it is. That is what makes this worth fixing rather than tolerating.

Do NOT record a cause for the timing sensitivity; it has not been diagnosed. The fix likely means making the assertion independent of wall-clock or real timers rather than raising a threshold, since 02-code-standards mandates fake timers and a threshold bump would only move the flake.

Acceptance: the test passes reliably inside a repo-wide pnpm test on this machine, and its pass/fail does not depend on how much else is running.
<!-- SECTION:DESCRIPTION:END -->
