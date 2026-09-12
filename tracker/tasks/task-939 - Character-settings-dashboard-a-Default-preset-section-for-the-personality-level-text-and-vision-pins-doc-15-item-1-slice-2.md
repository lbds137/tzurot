---
id: TASK-939
title: >-
  Character settings dashboard: a Default preset section for the
  personality-level text and vision pins (doc-15 item 1, slice 2)
status: To Do
assignee: []
created_date: '2026-09-12 06:29'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 937000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: slice 1 (PR 2398, TASK-46) shipped PUT and DELETE /api/user/personality/:slug/default-config?slot=text|vision, so a creator can pin a preset on their character, but nothing in Discord calls them; the only writers of those rows today are the shapes import (provenance: the pin a shapes.inc import stamps) and the admin path. doc-15 item 1 names the /character settings dashboard section as the second slice.
Fix shape: add a Default preset page to the /character settings dashboard (owner-only, same permission check as the other pages) with two settings, text preset and vision preset, each a select over the presets the caller can see (global or owned, the same set verifyConfigAccess admits), a Clear action per slot, and a provenance line when the current pin came from a shapes import so the owner knows what they are overwriting. Register the dashboard in the DASHBOARDS round-trip registry; the typed client methods are setPersonalityDefaultConfig and clearPersonalityDefaultConfig on the user client. Run pnpm test:component (snapshot surface changes).
Acceptance: from /character settings the owner can pin, change and clear both slots and the /inspect model line on the next reply reflects the pin; a non-owner never sees the page; the shapes-import pin renders its provenance; component snapshots updated.
<!-- SECTION:DESCRIPTION:END -->
