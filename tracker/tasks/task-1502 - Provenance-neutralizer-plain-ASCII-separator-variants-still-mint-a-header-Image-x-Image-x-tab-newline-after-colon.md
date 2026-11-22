---
id: TASK-1502
title: >-
  Provenance neutralizer: plain-ASCII separator variants still mint a header
  ([Image:x], [Image : x], tab/newline after colon)
status: To Do
assignee: []
created_date: '2026-11-22T04:51:00Z'
labels:
  - area:common-types
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1502000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: cross-family review of merged PR 2781 (TASK-1485) probed neutralizeHeaderMarkers (packages/common-types/src/utils/attachmentProvenance.ts, grep HEADER_OPENER_RUN) at bed51ae61 by running it under node. These ASCII-only shapes pass through unchanged and read to a model as a provenance header: [Image:x] (no space after colon), [Image : x] (space before colon), [Image:<TAB>x], [Image:<LF>x], [Spoiler  image: x] (double space inside a label), [ Image: x] (space after the opener, currently PINNED as unchanged by the test leaves an ASCII space between opener and label unchanged). None needs Unicode, so the invisible-character hardening of TASK-1375/1485 is bypassed by typing. The first five are not named in the unpinned-limit JSDoc paragraph. Third round of enumerate-the-gap on this regex (TASK-1027, 1375, 1485): each fix closes the probed shapes, the next review finds the adjacent ones.
What: switch from exact-shape matching to a tolerant one: after the opener run, allow a bounded noise class (whitespace incl. NBSP/U+3000, HEADER_INVISIBLE_SOURCE) before the label, between label words and before the colon; accept [:\uFF1A] and any whitespace-or-nothing after it. Decide whether matching should run on an NFKC-folded view (folds fullwidth colon and math-alphanumeric letters) with the strip mapped back, or simply on the raw text with the widened classes. Keep linear time and re-pin the [ Image: case as defused.
Acceptance: each shape above is defused and tested; the unpinned-limit paragraph is rewritten to the remaining out-of-scope set; linear-time cases stay green.
<!-- SECTION:DESCRIPTION:END -->
