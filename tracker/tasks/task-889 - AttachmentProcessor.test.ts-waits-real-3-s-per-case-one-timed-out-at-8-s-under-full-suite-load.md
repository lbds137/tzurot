---
id: TASK-889
title: >-
  AttachmentProcessor.test.ts waits real 3 s per case; one timed out at 8 s
  under full-suite load
status: To Do
assignee: []
created_date: '2026-09-04 17:18'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 887000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: during the beta.216 batch 3 gates (2026-09-04), the full pnpm test run lost the ai-worker case "threads the bound logger into withRetry so retry warnings correlate too" (services/ai-worker/src/services/AttachmentProcessor.test.ts) to an 8146 ms timeout against the 5000 ms vitest default; the package standalone was 5537/5537 and a full rerun was green. The verbose log shows a dozen sibling cases in that file each taking ~3000 ms (the image/voice failure-path cases, the STT retry cases), which means they wait on real timers instead of fake ones (02-code-standards.md Fake Timers, ALWAYS use). Same class as the TASK-778/853/873 hysteresis seam, closed in #2330 by removing the cost rather than raising a timeout.
Fix shape: read the file whole; find the real delay (a withRetry backoff or a per-attachment timeout the tests let elapse), switch those describes to vi.useFakeTimers with vi.runAllTimersAsync after attaching the rejection handler, and confirm every ~3000 ms case drops to milliseconds in --reporter=verbose. Do not raise the it() timeout.
Acceptance: npx vitest run src/services/AttachmentProcessor.test.ts --reporter=verbose shows no case above ~100 ms; the file count stays 31 passed; reverting the fake-timer switch brings the ~3000 ms durations back (canary). Filed by the assistant during a drain session; counts against the net.
<!-- SECTION:DESCRIPTION:END -->
