---
id: TASK-912
title: >-
  Settings dashboard cannot show or clear an empty slug list (Archive Split
  Render renders as **)
status: To Do
assignee: []
created_date: '2026-09-07 22:11'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 910000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Memory Archive page of /admin settings edit renders the empty archiveSplitRenderPersonalities list as a bare ** (the default branch of formatSettingValue in services/bot-client/src/utils/dashboard/settings/SettingsDashboardBuilder.ts stringifies the array, so [] becomes an empty string inside the bold wrapper), and the modal submit path in settingsModalSubmit.ts rejects an empty TEXT value with Value cannot be empty, so once a slug is listed the dashboard cannot clear the list back to every-character-verbatim. /admin settings set handles both (displayValue renders _(none)_ and parseSlugList turns a comma into an empty list), so the slash command is the workaround. Owner hit the ** render on 2026-09-07 while looking at the switch page before the rollout; the clear path is the rollout rollback control, which is why this is medium.
Fix shape: in the dashboard, list-control values render as (none) when empty and as the joined slugs otherwise; a list-control modal submit accepts an empty or comma-only input as clear-the-list instead of erroring. The list control reaches the dashboard as SettingType.TEXT today, so either carry the registry control on the definition or add a list setting type; pick whichever keeps the modal-submit branch readable. Tests on both branches, proven red first.
Acceptance: the Memory Archive page shows (none) for an empty list and the slugs otherwise; editing the field to empty through the modal clears the list and the page re-renders (none); /admin settings set behavior unchanged.
<!-- SECTION:DESCRIPTION:END -->
