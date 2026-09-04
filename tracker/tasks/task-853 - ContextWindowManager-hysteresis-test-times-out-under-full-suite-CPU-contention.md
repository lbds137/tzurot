---
id: TASK-853
title: ContextWindowManager hysteresis test times out under full-suite CPU contention
status: Done
assignee: []
created_date: '2026-09-01 14:03'
updated_date: '2026-09-04 16:41'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 853000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the ai-worker unit test HYSTERESIS / HEAD STABILITY (src/services/context/ContextWindowManager.test.ts:539) token-measures 60 built entries and needs ~2s of CPU. Under a full pnpm test run on the Steam Deck (26 packages competing, even with LOW_RESOURCE_MODE=1) it intermittently exceeds the 5000ms vitest timeout - identified 2026-09-01 after three full-run failures in one evening, standalone green every time, CI green throughout (isolated runners). This is the recurring local ai-worker full-run flake, now with a named cause.

Fix shape: pass an explicit generous timeout on that it() (a CPU-bound test with a measured ~2s baseline deserves 20s headroom), or make the fixture lighter if 60 entries is more than the hysteresis property needs. Verify with a loaded-machine full run.

Acceptance: three consecutive full pnpm test runs on the Deck without an ai-worker timeout failure.
<!-- SECTION:DESCRIPTION:END -->
