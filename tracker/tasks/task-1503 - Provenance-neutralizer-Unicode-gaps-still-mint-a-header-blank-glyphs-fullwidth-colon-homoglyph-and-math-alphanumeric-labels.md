---
id: TASK-1503
title: >-
  Provenance neutralizer: Unicode gaps still mint a header (blank glyphs,
  fullwidth colon, homoglyph and math-alphanumeric labels)
status: To Do
assignee: []
created_date: '2026-11-22T04:51:00Z'
labels:
  - area:common-types
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1503000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the same PR 2781 review probe (bed51ae61) confirmed these still pass unchanged: blank or invisible characters outside HEADER_INVISIBLE_SOURCE between opener and label (U+2800 Braille blank, U+17B4 Khmer inherent vowel, U+3000 ideographic space), NBSP inside a multi-word label or after the colon, the fullwidth colon U+FF1A, a Cyrillic I (U+0406) or mathematical-bold I (U+1D408) as the label initial, and a combining acute on a label letter. The JSDoc names several as unpinned limits, but no tracker task owned them, so the limit had no disposition.
What: after TASK-1502 lands (it may already cover the whitespace and colon cases), decide the folding strategy for letters: NFKC folds math-alphanumerics and fullwidth forms; Cyrillic/Greek look-alikes need a confusables skeleton (UTS 39) for the ten label words; combining marks (Mn) between label letters can join the invisible class.
Acceptance: each probed shape is defused or explicitly ruled out with a reason in the JSDoc; tests pin each.
Depends on: TASK-1502.
<!-- SECTION:DESCRIPTION:END -->
