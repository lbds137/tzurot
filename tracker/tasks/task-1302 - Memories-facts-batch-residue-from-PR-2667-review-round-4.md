---
id: TASK-1302
title: Memories/facts batch residue from PR 2667 review rounds 4-5
status: To Do
assignee: []
created_date: '2026-10-26T22:18:00Z'
updated_date: '2026-10-26T22:42:00Z'
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
Why: PR 2667 (TASK-1291 slice c) merged at review round 4 by owner ruling; its round-4 lows and test gaps land here. What: (1) UX: a locked item's result line shows a doubled lock icon, e.g. '🔐 🔐 Content … — already locked', because formatMemorySelectOption / formatFactSelectOption prefix AUTOCOMPLETE_BADGES.LOCKED and the locked status glyph adds another (on-page locked items already did this; the seam test at memoriesBatch.seam.test.ts pins the doubled string). Fix: build result-line labels without the badge and update that assertion (review round 5 raised it again, same fix). Items 2 and 3 (stale toLockableResultLine comment, resolveBatchLabels docstrings) were fixed before merge in the PR's last commit. (4) Copy nit: a 200 { success: false } delete classifies as InfraError and renders the try-again copy; decide whether a contract-breaking body deserves different copy. (5) Seam tests: a lock run whose per-id read fails (no mutation, failed line), and a search-kind session (every id via the per-id read, refreshed search view). (6) Round 5: buildSkippedLockableLine (lockableBatchOutcome.ts) renders a reasonless failed line when an id is skipped with no gone/locked/read-error record; a future skip reason added to runIds without a branch there would fail silently, so warn (logger.warn) when readErrors has no entry for the id. (7) Round 5: in services/bot-client/src/test/mockRedis.ts every pipeline() call empties the shared pipelineOps log, so a second pipeline created before the first one's exec() erases its record; add a one-line note that it holds only the most recent pipeline. The mirrored run-planning block is TASK-1301. Acceptance: item 1 fixed with the seam assertion updated, 4 decided, both seam cases added, 6 and 7 done.
<!-- SECTION:DESCRIPTION:END -->
