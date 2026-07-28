---
id: TASK-320
title: Retention-orphaned characters show creator Unknown in browse
status: To Do
assignee: []
created_date: '2026-07-24 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 320000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-24 (retention PR-B #1780, D11) — a retention-orphaned character shows its creator as **"Unknown"** in `/character browse` (the sentinel owner's reserved non-numeric discordId fails Discord `users.fetch` → the `'Unknown'` fallback in `commands/character/api.ts`). Functionally fine (orphans stay usable), but a departed-owner character reads as creatorless rather than "Orphaned Characters". **Fix shape**: special-case the sentinel discordId in the browse creator-name resolution (surface `ORPHAN_SENTINEL_USERNAME`), landing with the Phase-3 reclamation/management commands that already touch this surface. **Promote when**: Phase 3 (sentinel admin/reclamation) lands, or a browse-creator-display change touches `character/api.ts`.

**Why:** Cosmetic display gap, deferred with the rest of sentinel management per D11's Phase-3 scoping.
<!-- SECTION:DESCRIPTION:END -->
