---
id: TASK-1079
title: >-
  Share Chat History drill-down on both character dashboards builds a 107-char
  customId and throws
status: Done
assignee: []
created_date: '2026-09-24 14:11'
updated_date: '2026-09-24 16:57'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1072000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Discord caps a component customId at 100 characters, and discord.js validates it (no disableValidators call anywhere in bot-client or packages). The settings dashboards build value-button ids as entity::set::<entityId>::<settingId>:<value> (buildSettingsCustomId in services/bot-client/src/utils/dashboard/settings/types.ts). For the character dashboards the entityId is a 36-char UUID, so character-overrides::set::<uuid>::shareHistoryAcrossPersonalities:guilds-only is 107 chars, and the character-settings twin is 106. The doc-72 PR A orchestrator (2026-09-24) rendered every dashboard message with the real builders and measured this; with validators on, rendering the Share Chat History drill-down throws Invalid string length. Every other dashboard id is 94 or shorter. The setting shipped in beta.209 (7f35691a3, 2026-08-25), so the failure has been reachable on prod for a month. NOT log-confirmed: only the current prod bot-client deployment (250 lines, since 2026-09-24 07:28 EDT) was grepped, with 0 hits; older deployments were not swept.
Fix shape: shorten the set-button id encoding for every dashboard, not just this setting: e.g. an index into the setting definition's value list instead of the value string, or a short setting alias. Add a test that builds every dashboard's every message with a 36-char UUID entity id and asserts every customId is at most 100 chars (the orchestrator's probe script shape), so a future long setting name or value fails CI.
Acceptance: the Share Chat History drill-down renders on both character dashboards; the all-dashboards customId-length test exists and goes red on a canary that lengthens a value.
<!-- SECTION:DESCRIPTION:END -->
