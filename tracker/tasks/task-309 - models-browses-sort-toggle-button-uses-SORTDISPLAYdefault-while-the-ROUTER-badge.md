---
id: TASK-309
title: /models browse sort-toggle emoji collides with the ROUTER badge
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 309000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1744 PR body + r2 review observation) — `/models browse`'s sort-toggle button uses 🔀 (`SORT_DISPLAY.default`) while the ROUTER badge is now registry-official 🔀 on the same screen: a control-register glyph and a badge-register glyph co-occur on one surface (same carve-out class as ⚠️, but those never share a screen). **Fix shape**: swap the sort button's glyph (↕️ or 🎯 — it means "usable first", not shuffle) — one character in `SORT_DISPLAY`. **Promote when**: PR-3/enforcement wave's vocabulary re-audit, or the next models-browse touch.

**Why:** Button emoji are outside §2.2's letter; the confusion is real but redesigning controls mid-sweep was wrong scope — one-line fix at the next touch.
<!-- SECTION:DESCRIPTION:END -->
