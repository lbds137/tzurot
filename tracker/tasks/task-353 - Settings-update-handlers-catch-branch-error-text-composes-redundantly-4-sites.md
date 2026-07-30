---
id: TASK-353
title: >-
  Settings update handlers: catch-branch error text composes redundantly (4
  sites)
status: Done
assignee: []
created_date: '2026-07-29 13:20'
updated_date: '2026-07-30 12:07'
labels:
  - 'origin:review'
dependencies: []
priority: low
ordinal: 353000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: handleSetButton renders `Failed to update: ${result.error}` and four update-handler catch branches return error 'Failed to update setting', composing into "Failed to update: Failed to update setting". Sites: admin/settings.ts, admin/settingsSystemUpdate.ts, settings/defaults/edit.ts, channel/settings.ts (the reset path in channel/settings.ts was already de-duped in #1854 — same one-line shape).
Fix shape: return a bare cause (e.g. 'unexpected error, please try again') at each site, mirroring #1854 reset-catch precedent. Surfaced by #1854 r4 review.
<!-- SECTION:DESCRIPTION:END -->
