---
id: TASK-614
title: >-
  Positional test-file filters are ignored — every vitest invocation runs the
  full package suite
status: To Do
assignee: []
created_date: '2026-08-15 01:24'
labels:
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 614000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: refreshing the command-manifest snapshot documents `pnpm --filter @tzurot/bot-client test -- -u src/handlers/commandManifest.test.ts`, which reads as a targeted single-file run. It is not. Measured 2026-08-14, both forms run all 401 bot-client test files (6312 tests, ~2 min):
  - CI=1 pnpm --filter @tzurot/bot-client test -- -u src/handlers/commandManifest.test.ts  -> Test Files 401 passed
  - npx vitest run --root services/bot-client -u src/handlers/commandManifest.test.ts      -> Test Files 401 passed
So the positional path filter is dropped somewhere in the workspace/vitest config, not just mangled by pnpm arg forwarding. Cost: anyone iterating on one test file pays a full-suite run, and a worker lost time assuming the second form was the working targeted one.

What: find why the positional include filter does not narrow the run (vitest projects/workspace config is the likely suspect), then either fix it or correct the two headers that advertise it — commandManifest.test.ts line 17 and the AUTO-GENERATED warning string it writes into command-manifest.json around line 100.

Acceptance: a documented command that provably runs ONE test file, with the Test Files count quoted as evidence; both headers updated to match.
<!-- SECTION:DESCRIPTION:END -->
