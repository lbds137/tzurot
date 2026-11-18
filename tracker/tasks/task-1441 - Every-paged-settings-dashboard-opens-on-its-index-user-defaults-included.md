---
id: TASK-1441
title: Every paged settings dashboard opens on its index (user defaults included)
status: Done
assignee: []
created_date: '2026-11-17T20:29:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1441000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila 11-17 — /settings defaults opens on page 1 while the admin settings dashboard opens on its index; she wants the admin format reflected consistently in the user and override dashboards. This reverses the 09-24 owner ruling recorded in doc-72 and ux-design-system-spec (dashboards of 3 pages or fewer open on page 1: "a hub in front of three pages or fewer is ceremony").

What: INDEX_LANDING_MIN_PAGES (services/bot-client/src/utils/dashboard/settings/settingsIndexView.ts:37) drops so every dashboard with 2+ pages lands on the index; a 1-page dashboard keeps the overview. Update the tests that pin page-1 landing (settings/defaults/edit.test.ts) and the prose in doc-72, docs/proposals/backlog/ux-design-system-spec.md and the SettingsDashboardHandler comment.

Acceptance: /settings defaults, character settings, character overrides and channel settings open on the index; a test pins the landing view for a 3-page config; the decision reversal is written back into doc-72. Ships in beta.246 (her pick 11-17).
<!-- SECTION:DESCRIPTION:END -->
