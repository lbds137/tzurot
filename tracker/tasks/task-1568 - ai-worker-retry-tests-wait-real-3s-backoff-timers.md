---
id: TASK-1568
title: ai-worker retry tests wait real 3s backoff timers
status: To Do
assignee: []
created_date: '2026-11-27T04:57:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1558000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: test-speed measurement 2026-11-26 (baseline 20m53s wall, suite-time row tzurot-full-test-baseline): the slowest individual tests are ~10 real-timer retry tests at ~3s each in AudioProcessor.test.ts (6) and ReferencedMessageFormatter.test.ts (3) — real exponential-backoff sleeps, the only per-test cost that moved in the data. What: make the retry backoff base delay injectable (constructor or options param) in the AudioProcessor and ReferencedMessageFormatter retry paths, pass 0-10ms in tests, keep prod defaults. Acceptance: those tests drop under 200ms each with the retry-count assertions unchanged; no prod call site changes its delay.
<!-- SECTION:DESCRIPTION:END -->
