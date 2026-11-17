---
id: TASK-1427
title: Add Both slot choice to /preset override set and clear
status: Done
assignee: []
created_date: '2026-11-16T20:37:00Z'
updated_date: '2026-11-17T15:26:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1427000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner ruling 2026-11-16 (AskUserQuestion): add the Both slot choice to /preset override set and /preset override clear, matching the default setters. Today the override sites use CONFIG_SLOT_OPTION_CHOICES (Chat/Vision only, packages/common-types/src/constants/ai.ts) while default set/clear, global default and global free-default spread CONFIG_SLOT_OPTION_CHOICES_WITH_BOTH (services/bot-client/src/commands/preset/index.ts). The docstring reason for the split (an override pins one slot per character) is inaccurate: override clear with no slot clears all slots (services/bot-client/src/commands/preset/override/clear.ts:32), so a character carries separate Chat and Vision overrides.

What: switch both override slot options to CONFIG_SLOT_OPTION_CHOICES_WITH_BOTH; bot-client override set/clear read the option via toModelSlotOrBoth; the api-gateway override route accepts the both alias and expands it into a text write and a vision write with the vision-capability gate first (mirror the default-setter expansion). Rewrite the CONFIG_SLOT_OPTION_CHOICES_WITH_BOTH docstring so it no longer limits Both to default setters. Refresh the CommandHandler component snapshot and surface:inventory.

Acceptance: override set slot:Both pins the preset on both slots (vision-incapable preset rejected before any write); override clear slot:Both clears both; tests at the bot-client and gateway seams.
<!-- SECTION:DESCRIPTION:END -->
