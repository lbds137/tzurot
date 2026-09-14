---
id: TASK-973
title: >-
  Reserved-fact slot behavior has no EARS spec entry in the memory-archive
  intent specs
status: To Do
assignee: []
created_date: '2026-09-14 00:09'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 969000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR #2419 round 2, informational. FactRetriever fail-soft behavior is already EARS-tracked — MEM-ARCH-011 covers the linked-facts degrade and its tag sits directly above the new reserved-fact describe block in services/ai-worker/src/services/FactRetriever.test.ts. The reserved-slot feature added a four-way degrade matrix (embedding fails, similarity fails, reserved fails, both fail) plus the reserved-first merge, and none of it has a spec id in docs/intent/memory-archive/memory-archive-specs.md. The PR body carries acceptance traceability for that PR, so nothing is untracked today; the question is whether this subsystem stays fully EARS-tracked going forward.
Why this was NOT done in the PR: it is a taxonomy question, not a coverage gap. The memory-archive specs track the ARCHIVE subsystem, and the prompt facts block is a neighbouring concern that happens to share the FactRetriever module. Guessing at the boundary inside a review round would put an entry in a doc that may not own it. Decide the boundary first.
Fix shape: decide whether the facts-block retrieval behavior belongs in memory-archive-specs.md or in its own intent doc. If the former, add spec ids for the degrade matrix and the reserved-first merge and tag the corresponding tests, mirroring how MEM-ARCH-011 is tagged. If the latter, create the doc and move MEM-ARCH-011 out of the archive spec too, so the split is clean rather than half-applied.
Acceptance: either the reserved-slot degrade matrix and merge carry spec ids with tagged tests, or a written decision records that facts-block retrieval is deliberately outside the EARS-tracked surface.
<!-- SECTION:DESCRIPTION:END -->
