---
id: TASK-1296
title: 'knip hint: railway in ignoreBinaries reported as removable'
status: To Do
assignee: []
created_date: '2026-10-26T14:15:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1282000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: local pnpm knip (2026-10-26, on fix/override-batch-residue) prints a configuration hint "railway knip.json Remove from ignoreBinaries"; knip exits 0, so nothing gates on it. What: knip.json:75 lists railway in ignoreBinaries; services/bot-client/package.json:23 (deploy-commands:railway) is the only script calling it. Decide whether knip now resolves railway on its own (it is on the Deck PATH) or only locally: run knip in CI (or a shell without railway on PATH) before removing, since removal may break CI where the binary is absent. Acceptance: the hint is gone locally and CI knip stays green, or a one-line reason in knip.json for keeping it.
<!-- SECTION:DESCRIPTION:END -->
