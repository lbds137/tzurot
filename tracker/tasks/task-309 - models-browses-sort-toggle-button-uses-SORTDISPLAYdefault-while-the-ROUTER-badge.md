---
id: TASK-309
title: /models browse sort-toggle emoji collides with the ROUTER badge
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-09-04 19:40'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 309000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1744 PR body + r2 review observation) — `/models browse`'s sort-toggle button uses 🔀 (`SORT_DISPLAY.default`) while the ROUTER badge is now registry-official 🔀 on the same screen: a control-register glyph and a badge-register glyph co-occur on one surface (same carve-out class as ⚠️, but those never share a screen). **Fix shape**: swap the sort button's glyph (↕️ or 🎯 — it means "usable first", not shuffle) — one character in `SORT_DISPLAY`. **Promote when**: PR-3/enforcement wave's vocabulary re-audit, or the next models-browse touch.

**Why:** Button emoji are outside §2.2's letter; the confusion is real but redesigning controls mid-sweep was wrong scope — one-line fix at the next touch.

**DECIDED 2026-08-14 (owner, TASK-599 digest): swap the sort-toggle glyph to the up-down arrows emoji (U+2195) in SORT_DISPLAY; lands at the next models-browse touch.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner already decided the fix (swap to U+2195) on 2026-08-14; it just hasn't been built yet — this is a scheduled one-line change, not a re-litigation. Evidence: `sed -n '67,71p' services/bot-client/src/commands/models/browse.ts` → `SORT_DISPLAY.default.emoji` is still `🔀`, not yet swapped.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
