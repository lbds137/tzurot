---
id: TASK-1302
title: Memories/facts batch residue from PR 2667 review round 4
status: To Do
assignee: []
created_date: '2026-10-26T22:18:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1286000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2667 (TASK-1291 slice c) merged at review round 4 by owner ruling; its round-4 lows and test gaps land here. What: (1) UX: a locked item's result line shows a doubled lock icon, e.g. '🔐 🔐 Content … — already locked', because formatMemorySelectOption / formatFactSelectOption prefix AUTOCOMPLETE_BADGES.LOCKED and the locked status glyph adds another (on-page locked items already did this; the seam test at memoriesBatch.seam.test.ts pins the doubled string). Fix: build result-line labels without the badge and update that assertion. (2) Stale comment: toLockableResultLine in commands/memory/lockableBatchOutcome.ts still says an off-page id has UNKNOWN lock state so the 403 is the only honest locked signal; now the 403 only covers a failed read or a lock that landed between read and mutation. (3) Docstring: the resolveBatchLabels JSDoc in factsBatch.ts and memoriesBatchConfirm.ts says the id-prefix fallback is only for reads that 404; a read that throws also falls back. (4) Copy nit: a 200 { success: false } delete classifies as InfraError and renders the try-again copy; decide whether a contract-breaking body deserves different copy. (5) Seam tests: a lock run whose per-id read fails (no mutation, failed line), and a search-kind session (every id via the per-id read, refreshed search view). The mirrored run-planning block is TASK-1301. Acceptance: items 1-3 fixed with the seam assertion updated, 4 decided, both seam cases added.
<!-- SECTION:DESCRIPTION:END -->
