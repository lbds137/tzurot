---
id: TASK-1159
title: >-
  Preset override browser: show the user default preset beside per-character
  overrides, plus clear-all
status: To Do
assignee: []
created_date: '2026-10-04 16:45'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-10-04 (own words): "maybe an override browser for presets? showing global default for the user as well as any per character overrides, with easy buttons for clearing any / all". CHECKED FIRST: /preset override browse ALREADY EXISTS (services/bot-client/src/commands/preset/override/browse.ts on the shared utils/overrideBrowse.ts): it lists the per-character overrides (a character with text AND vision overrides shows two rows, one per slot) and clears ONE row at a time via a select menu. So the residual is narrower than the intake reads: (1) the browser does not show the user own default preset (text and vision slots; set by /preset default set), and (2) there is no clear-all button, nor a clear-defaults action in the same view.
What: extend the shared override browser (overrideBrowse.ts) so the preset instance renders the user default rows (text + vision) above the override rows, with a clear button for the default, and a Clear all overrides button (Tier-appropriate confirm, destructive last per the button order). Check who else uses overrideBrowse before changing shared behavior (grep its importers; the persona/other override browsers must not regress).
Acceptance: /preset override browse shows the default slots and the overrides, offers per-row clear and clear-all, each pinned by a handler test; shared-browser consumers unchanged.
<!-- SECTION:DESCRIPTION:END -->
