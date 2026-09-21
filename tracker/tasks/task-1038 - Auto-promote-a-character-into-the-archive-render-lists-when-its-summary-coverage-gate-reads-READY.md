---
id: TASK-1038
title: >-
  Auto-promote a character into the archive render lists when its
  summary-coverage gate reads READY
status: To Do
assignee: []
created_date: '2026-09-21 19:48'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1032000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner direction 2026-09-21 - applying the memory-archive treatment to more characters currently means hand-listing each slug in archiveSplitRenderPersonalities (and recentDaysDigestPersonalities) after checking the 95 percent gate with pnpm memory:summarize --dry-run (packages/tooling/src/commands/memory.ts ~line 309; the per-character list settings are in packages/common-types/src/schemas/api/systemSettingsRegistryOperations.ts ~lines 28-42 and 151-162). The owner does not want to maintain that list by hand for every character they talk to. The gate is already computed per personality by the pre-warm sweep, so promotion can be automatic.
Fix shape: in the archive-summary sweep (or a daily tick beside it), when a personality with the enqueue switch on reaches the 95 percent summary-coverage gate, append its slug to archiveSplitRenderPersonalities if absent, log the promotion at info with the personality id and coverage, and post the same line to the owner log channel so the flip is visible. Keep a per-character opt-out (a list of slugs never to promote) for characters the owner wants verbatim; demotion stays manual. Decide with the owner whether recentDaysDigestPersonalities promotes on the same signal or stays manual, since that list carries spend.
Acceptance: a component test seeds a personality at 94 percent and one at 96 percent coverage, runs the tick, and asserts only the second is listed; a listed character is not re-listed; an opted-out character at 100 percent is skipped; the log line names the personality id and coverage.
<!-- SECTION:DESCRIPTION:END -->
