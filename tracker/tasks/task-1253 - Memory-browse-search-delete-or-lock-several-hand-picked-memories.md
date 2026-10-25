---
id: TASK-1253
title: 'Memory browse/search: delete or lock several hand-picked memories'
status: Done
assignee: []
created_date: '2026-10-19 03:41'
updated_date: '2026-10-25 02:13'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1241000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /memory browse and /memory search act on one memory per round trip (3N). services/bot-client/src/commands/memory/detail.ts:246 handleMemorySelect. Filter-based bulk delete already exists (commands/memory/batchDelete.ts, /memory delete); this adds hand-picked sets. Gateway calls take one memoryId.

Shape (doc-113): keep the one-pick select that opens a single item; add a Select several button that swaps in a separate multi-select (min 1, max = page size, at most 25) feeding a batch confirm that lists every affected item; the result names per-item failures. The first of these tasks to be built extracts the shared helper into utils/browse/; the rest reuse it. Owner pick 2026-10-18 via Machloket Client (Lila picked items 1-5 of the multi-select audit).

Acceptance: N items take 2 interactions after the change; a partial failure reports which items failed; the one-pick open path is unchanged; the Discord behaviour that a multi-select submits on close, not on a single tap, is checked against the Discord docs before the design depends on it.
<!-- SECTION:DESCRIPTION:END -->
