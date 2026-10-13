---
id: TASK-1227
title: >-
  Split render drops the character side entirely for memories with no done
  summary
status: To Do
assignee: []
created_date: '2026-10-13 01:26'
updated_date: '2026-10-13 01:56'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1216000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: code read (MemoryNoteSplitRender.ts renderSplitNoteBody, ~L100-161): in split mode a memory without a stored assistantSummary renders the user turn plus linked facts only, so the character reply vanishes; with no linked facts nothing replaces it. TASK-1224 measured 191 of 1,511 recalled Emily/owner memories in that state (36 failed, 51 dead, 16 pending, 88 never summarized). Would read as the character forgetting what she herself said or promised. Not runtime-confirmed.

What: (1) confirm with one real render of a dead memory; (2) render a capped verbatim slice of the assistant turn when no summary exists (doc-8 ruled that null never renders verbatim once switched on; this reverses that for the no-summary case, so record the reason in memory-archive-format.md); (3) find out why all 51 dead rows are still recalled, and backfill the 88 recalled never-summarized rows.

Acceptance: a split-mode note with no summary shows a bounded excerpt of the character turn, with a test pinning it; dead-row cause recorded.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-10-12 (AskUserQuestion): YES, capped verbatim excerpt of the character turn when no summary exists. The doc-8 'null never renders verbatim once switched on' ruling was about summarized rows; write this exception and its reason into memory-archive-format.md in the same PR.
<!-- SECTION:NOTES:END -->
