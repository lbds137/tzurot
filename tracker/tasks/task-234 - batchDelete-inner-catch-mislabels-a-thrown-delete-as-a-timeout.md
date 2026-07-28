---
id: TASK-234
title: batchDelete inner catch mislabels a thrown delete as a timeout
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 234000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

batchDelete inner catch mislabels a thrown delete as a timeout — `memory/batchDelete.ts`'s inner try around `userClient.batchDelete()` unconditionally renders 'Deletion cancelled - confirmation timed out.' on ANY thrown exception — a real (possibly-applied) write failure reads as a benign timeout, hiding the duplicate-write-risk the campaign exists to surface. Pre-existing (not the D3a sweep). **Fix shape**: distinguish the awaitMessageComponent timeout from a thrown batchDelete() failure — classify the latter via classifyGatewayFailure. ALSO in this family: `purge.ts`'s `executePurgeHandshake`/`handlePurgeModal` have no try/catch, so a THROWN (not `!ok`) `issuePurgeToken`/`purge` propagates uncaught past the classify logic to CommandHandler's generic catch-all (pre-existing, not a regression). Same fix shape — wrap the write and classify. **Promote when**: next touch of batchDelete or the purge handshake, or a user reports a confusing 'timed out' on a partially-applied delete. Surfaced 2026-07-08 (PR #1557 rounds 2+5 review).

**Why:** Outcome-honesty on the one memory write the sweep couldn't reach.
<!-- SECTION:DESCRIPTION:END -->
