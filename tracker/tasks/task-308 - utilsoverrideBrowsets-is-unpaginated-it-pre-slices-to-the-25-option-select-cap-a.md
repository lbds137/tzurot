---
id: TASK-308
title: 'utils/overrideBrowse.ts is unpaginated: it pre-slices to the 25-option select cap and…'
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
labels:
  - 'area:voice'
dependencies: []
ordinal: 308000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (Phase 3 planning census) — `utils/overrideBrowse.ts` is unpaginated: it pre-slices to the 25-option select cap and footers "first 25 shown; use `/…clear` for the rest". Fine at current per-user override counts. **Fix shape**: adopt the browse builder's server-page mode (both consumers — settings-preset-override + voice-tts-override — share the one helper). **Promote when**: any user's override list exceeds 25, or the next overrideBrowse touch.

**Why:** A disclosed cap with zero real-world hits; pagination is mechanical when the trigger fires.
<!-- SECTION:DESCRIPTION:END -->
