---
id: TASK-1166
title: >-
  /preset default: add a both option to set text and vision defaults in one
  command
status: To Do
assignee: []
created_date: '2026-10-04 16:46'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-10-04: "for /preset default add a both option to quickly set a model for both text and vision lanes". Today /preset default set and clear take an optional slot choice built from CONFIG_SLOT_OPTION_CHOICES (packages/common-types/src/constants/ai.ts:385: text, vision) and the handler passes one slot to userClient.setDefaultModelConfig (services/bot-client/src/commands/preset/default/set.ts). A both choice means two writes, and the vision write is capability-gated by the gateway, so a preset without vision support must not half-apply.
What: add a both choice for set (and clear for symmetry) on the preset default group only - CONFIG_SLOT_OPTION_CHOICES is shared, so check its other importers (preset override set/clear) and decide whether both applies there too (owner said default only). Validate vision capability BEFORE any write so a text-only preset gives one clear refusal rather than a text write plus a vision failure; reply names what changed per slot. Regenerate the command option types (codegen) and the commands doc.
Acceptance: set both with a vision-capable preset writes both slots; with a text-only preset writes nothing and says why; clear both clears both; handler tests cover the three cases.
<!-- SECTION:DESCRIPTION:END -->
