---
id: TASK-1485
title: >-
  Provenance neutralizer: invisible characters inside or after the label, or
  non-Cf invisibles before it, still mint a header
status: To Do
assignee: []
created_date: '2026-11-21T00:16:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1485000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR 2775 (TASK-1375) probed neutralizeHeaderMarkers in packages/common-types/src/utils/attachmentProvenance.ts (grep HEADER_OPENER_RUN) and found five shapes that still pass unchanged: a Cf character inside the label (opener, Ima, U+200B, ge: x), a Cf character between the label and the colon (opener, Image, U+200B, : x), and non-Cf invisibles between the opener and the label (U+034F combining grapheme joiner, U+FE0F variation selector, U+3164 Hangul filler). A model plausibly reads each as a provenance header, so model output can still mint one. This is the same prompt-provenance defence TASK-1375 hardened.
What: let the label lookahead tolerate Cf between label characters and before the colon (the opener run is all that needs stripping, so the label text can stay), and decide a bounded invisible set for the opener-to-label gap (Cf plus named Mn/Lo fillers such as U+034F, U+FE00-U+FE0F, U+3164, U+115F, U+1160, U+FFA0). Keep the scan linear and pin that with the existing linear-time test shapes.
Acceptance: each of the five probed shapes is defused and tested; the unpinned-limit paragraph in the neutralizeHeaderMarkers doc matches what is still out of scope; existing tests stay green.
<!-- SECTION:DESCRIPTION:END -->
