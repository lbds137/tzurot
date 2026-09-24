---
id: TASK-1072
title: bot-client import-heavy tests time out on a cold full pnpm test on the Deck
status: To Do
assignee: []
created_date: '2026-09-24 02:52'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1065000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-24 two of two cold full `LOW_RESOURCE_MODE=1 pnpm test` runs on the Steam Deck failed @tzurot/bot-client on timeouts in import-heavy setup, forcing a re-run each time. services/bot-client/src/handlers/commandManifest.test.ts: the beforeAll that runs `new CommandHandler().loadCommands()` (imports every command module) hit the 10 s hookTimeout on both runs. services/bot-client/src/handlers/CommandHandler.test.ts case "should include index.ts in subdirectories" hit the 5 s testTimeout on the first run. Both runs reported ~280-305 s of total import time for bot-client; the same suites pass alone through turbo (452/452 files) and in CI.
Fix shape: give the loadCommands beforeAll an explicit timeout sized for a full command import under load (vitest hook timeout argument), with a comment naming why; check whether the CommandHandler.test.ts case really imports modules (its readdirSync is mocked) and fix the cause rather than only the budget. Do not raise the package-wide timeouts.
Acceptance: two consecutive cold `LOW_RESOURCE_MODE=1 pnpm test` runs on the Deck pass bot-client without a re-run.
<!-- SECTION:DESCRIPTION:END -->
