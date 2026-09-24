---
id: TASK-1001
title: Reset to defaults button on every settings page
status: Done
assignee: []
created_date: '2026-09-17 17:40'
updated_date: '2026-09-24 18:24'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 997000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-09-17 — after changing several overrides in one sitting, getting back to defaults means tracking down each row and resetting it one by one; there is no page-level reset on any settings dashboard (admin settings, user defaults, character overrides, channel settings). Discovered by use, not by report.
Fix shape: one Reset-to-defaults button per settings page (the page scope, not the whole dashboard) that clears every override the page owns, with a confirm step; the same handler shape for all dashboards built on utils/dashboard (settingsConfig pages, systemSettingsConfig groups). The whole-scope Reset ALL belongs on the hub page and is a member of doc-72, not this task. Snapshot tier: pnpm test:component after the component change.
Acceptance: every settings page renders the button; pressing it and confirming returns every row on that page to its Auto or default state in one round trip; the dashboards round-trip test still passes; docs/commands.md mentions the reset.
<!-- SECTION:DESCRIPTION:END -->
