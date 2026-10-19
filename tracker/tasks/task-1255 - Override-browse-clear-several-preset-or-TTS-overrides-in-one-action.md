---
id: TASK-1255
title: 'Override browse: clear several preset or TTS overrides in one action'
status: To Do
assignee: []
created_date: '2026-10-19 03:41'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1243000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /preset override browse and /voice tts browse (shared services/bot-client/src/utils/overrideBrowse.ts) clear one override per select + button (2N); handleOverrideBrowseSelect :268, handleOverrideBrowseButton :327; the delete takes a single personalityId.

Shape (doc-113): keep the one-pick select that opens a single item; add a Select several button that swaps in a separate multi-select (min 1, max = page size, at most 25) feeding a batch confirm that lists every affected item; the result names per-item failures. The first of these tasks to be built extracts the shared helper into utils/browse/; the rest reuse it. Owner pick 2026-10-18 via Machloket Client (Lila picked items 1-5 of the multi-select audit).

Acceptance: N items take 2 interactions after the change; a partial failure reports which items failed; the one-pick open path is unchanged; the Discord behaviour that a multi-select submits on close, not on a single tap, is checked against the Discord docs before the design depends on it.
<!-- SECTION:DESCRIPTION:END -->
