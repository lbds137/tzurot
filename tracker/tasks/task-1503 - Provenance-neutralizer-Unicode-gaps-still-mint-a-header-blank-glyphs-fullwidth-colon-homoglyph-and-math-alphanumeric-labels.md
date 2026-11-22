---
id: TASK-1503
title: >-
  Provenance neutralizer: Unicode gaps still mint a header (blank glyphs, NEL,
  homoglyph and math-alphanumeric labels)
status: To Do
assignee: []
created_date: '2026-11-22T04:51:00Z'
updated_date: '2026-11-22T07:09:00Z'
labels:
  - area:common-types
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1503000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1502 (PR 2784) closed NBSP (U+00A0), ideographic space (U+3000), and fullwidth colon (U+FF1A). Remaining undefused Unicode shapes probed on `neutralizeHeaderMarkers` (`packages/common-types/src/utils/attachmentProvenance.ts`): blank or invisible characters outside `HEADER_NOISE_SOURCE` (U+2800 Braille blank, U+17B4/U+17B5 Khmer inherent vowels), U+0085 NEL (Unicode `White_Space` / `Cc`, missed by JS `\s` and `\p{Cf}` — PR 2784 review also noted `HEADER_NOISE_SOURCE` JSDoc inaccurately equates `\s` with Unicode `White_Space`), other look-alike colons outside `[:\uFF1A]` (U+FE55, U+A789, U+2236), Cyrillic/Greek homoglyphs (e.g. U+0406) or mathematical-alphanumeric / fullwidth letters (e.g. U+1D408), combining marks (`Mn`) inside label letters, and non-`Ps` bracket-shaped characters.
What: (1) Fix the U+0085 NEL gap and `HEADER_NOISE_SOURCE` JSDoc (`\p{White_Space}` vs `\s`, plus note that U+180E is covered via `\p{Cf}`); (2) decide the folding strategy for letters (NFKC for math-alphanumerics/fullwidth, UTS 39 confusables skeleton for Cyrillic/Greek on the ten label words, `Mn` combining marks in the invisible class) and remaining blanks/colons; (3) fold in PR 2784 review polish: positive defuse tests for U+FEFF between label words and before the colon, and JSDoc notes on deliberate whitespace-strip layout trade-off (or opener-only strip) and wider post-colon match (`[File:///...`, `[Image:thumb]`).
Acceptance: each probed shape is defused or explicitly ruled out with a reason in the JSDoc; `HEADER_NOISE_SOURCE` JSDoc matches its exact regex class; tests pin each including U+0085 and positive U+FEFF separator cases.
<!-- SECTION:DESCRIPTION:END -->
