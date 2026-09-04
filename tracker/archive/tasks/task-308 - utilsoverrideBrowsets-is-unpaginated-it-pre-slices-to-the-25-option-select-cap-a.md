---
id: TASK-308
title: overrideBrowse.ts is unpaginated (pre-slices to the 25-option cap)
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:voice'
  - 'area:bot-client'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 308000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (Phase 3 planning census) — `utils/overrideBrowse.ts` is unpaginated: it pre-slices to the 25-option select cap and footers "first 25 shown; use `/…clear` for the rest". Fine at current per-user override counts. **Fix shape**: adopt the browse builder's server-page mode (both consumers — settings-preset-override + voice-tts-override — share the one helper). **Promote when**: any user's override list exceeds 25, or the next overrideBrowse touch.

**Why:** A disclosed cap with zero real-world hits; pagination is mechanical when the trigger fires.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-308 finds it.
---
<!-- COMMENTS:END -->
