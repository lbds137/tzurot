---
id: TASK-1102
title: >-
  buildSettingsCustomId has no structural length guard; the TASK-1079 class
  rests on one enumeration test
status: Done
assignee: []
created_date: '2026-09-25 15:10'
updated_date: '2026-09-25 16:32'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1095000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on the beta.230 release PR (#2535) observed that buildSettingsCustomId (services/bot-client/src/utils/dashboard/settings/types.ts) has no structural length guard. Safety against the TASK-1079 bug class (a 107-char customId that discord.js rejects at send time) rests entirely on settingsCustomIdLength.test.ts enumerating every dashboard action at worst-case UUID length; a new action added without a row in that enumeration is unguarded, and the failure surfaces on prod as an Invalid Form Body.

Fix shape: throw at build time past DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH the way buildOneAction in customIdFamily.ts does (grep buildOneAction), or route the settings ids onto defineCustomIdFamily as a doc-14 rollout slice; keep the enumeration test as the second pin either way.

Acceptance: a settings customId over 100 chars fails at build time with a test that pins it, and the enumeration test still passes.
<!-- SECTION:DESCRIPTION:END -->
