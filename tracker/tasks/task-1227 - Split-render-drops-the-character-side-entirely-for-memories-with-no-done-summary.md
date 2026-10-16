---
id: TASK-1227
title: >-
  Split render drops the character side entirely for memories with no done
  summary
status: To Do
assignee: []
created_date: '2026-10-13 01:26'
updated_date: '2026-10-16 06:24'
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
Split render drops the character side for memories with no done summary. RENDER HALF SHIPPED 2026-10-16: PR #2622 merged after 6 review rounds (capped 700-char assistantTurn excerpt, own notes only, foreign+chunk exclusions, wiring-tested seam, instruction + spec rows MEM-ARCH-002/038 amended, D2 reversal recorded in memory-archive-format.md). Remaining: part 3 - (a) confirm with one real render of a dead memory (prod/dev probe with the merged code); (b) record why all 51 dead rows are still recalled (cause + error classes from prod); (c) backfill the 88 recalled never-summarized rows via memory:summarize AFTER TASK-1226's ARCHIVE_SUMMARY_PROMPT_VERSION bump (pre-bump = double spend; the bump re-admits dead rows per MEM-ARCH-022). Review residue filed: TASK-1235 (unlabeled-excerpt speaker ambiguity), TASK-1236 (test precision batch + code-units wording); beta.237 watch: excerptNotes share vs the ~13% no-summary share.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-10-12 (AskUserQuestion): YES, capped verbatim excerpt of the character turn when no summary exists. The doc-8 'null never renders verbatim once switched on' ruling was about summarized rows; write this exception and its reason into memory-archive-format.md in the same PR.
<!-- SECTION:NOTES:END -->
