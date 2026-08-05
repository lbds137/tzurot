---
id: TASK-308
title: overrideBrowse.ts is unpaginated (pre-slices to the 25-option cap)
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-07-28 10:52'
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
