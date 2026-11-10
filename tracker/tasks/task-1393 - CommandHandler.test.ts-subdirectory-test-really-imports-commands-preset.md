---
id: TASK-1393
title: CommandHandler.test.ts subdirectory test really imports commands/preset
status: To Do
assignee: []
created_date: '2026-11-10T14:24:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1376000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the test at services/bot-client/src/handlers/CommandHandler.test.ts:120 mocks fs to list preset/index.ts, but CommandHandler.ts (~:105, :277) joins it to the real commands dir and does a real import(), loading a module graph: 1,078 ms unloaded, 5,046 ms timeout under load (failed push 1 on 11-10).
What: mock that import path (vi.doMock) or assert on the file-listing helper directly.
Acceptance: the test imports no real command module (Fable perf review 2026-11-10, item P9).
<!-- SECTION:DESCRIPTION:END -->
