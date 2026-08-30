---
id: TASK-788
title: Humanize raw enum values in /deny browse and detail rendering
status: Done
assignee: []
created_date: '2026-08-28 02:41'
updated_date: '2026-08-30 19:57'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 788000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner smoke feedback (2026-08-28): parts of the /deny browse experience show ugly all-caps text — raw DB enum values reaching the embeds. Verified sites: detailTypes.ts:70-73 renders entry.type raw (USER/GUILD) in the Type field and entry.mode raw (BLOCK/MUTE) in the Mode field, and scopeInfo (detailTypes.ts:61) humanizes only the BOT case — every other scope prints as e.g. GUILD: `id`.

Fix shape: map each enum to display copy (e.g. User / Server, Block / Mute, This server) at the render seam — a small label map beside the embed builders, not a DB or schema change. Sweep the whole deny family render surface for the class, not just the cited lines: browse rows and badge legend (browse.ts), detail card, view.ts, add/remove confirmation replies. Snapshot/component tests updated where they pin the strings.

Acceptance: no raw enum casing visible anywhere in the /deny UI; the label map is the single source for the display strings.
<!-- SECTION:DESCRIPTION:END -->
