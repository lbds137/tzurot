---
id: TASK-839
title: >-
  Settings drill-down Parent Value shows the effective value, not the parent
  tier
status: Done
assignee: []
created_date: '2026-08-31 12:31'
updated_date: '2026-08-31 18:58'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 839000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-08-31 (user-defaults dashboard, Max Age): admin default is 30 days; after setting a user override of off, the drill-down shows Parent Value: Off. The field mirrors whatever the override is instead of what removing it would restore — it can never show the true parent, and is only coincidentally right when override == parent.

Mechanism, verified in source: buildSettingEmbed renders value.effectiveValue under the Parent Value label (services/bot-client/src/utils/dashboard/settings/SettingsDashboardBuilder.ts:253), but effectiveValue is the FULLY RESOLVED cascade value including the local tier (settingsDataBuilder.ts:39-42 — straight from the resolve endpoint). The gateway resolve-defaults handler (services/api-gateway/src/routes/user/config-overrides.ts:83-106) merges hardcoded -> admin -> user-default in explicit layers and emits only the final resolution + sources, so the parent-tier value is computed and discarded. The doc comment at SettingsDashboardBuilder.ts:188-189 claims effectiveValue is the inherited parent-cascade value — the producer contradicts it. Affects all four cascade dashboards (admin/channel/character/user-defaults, per settingsDataBuilder.ts header) whenever a local override is set.

Fix shape: each resolve endpoint snapshots the resolution BEFORE applying the requesting tier and emits it (e.g. parentValues map beside sources); bot-client SettingValue gains parentValue, buildCascadeSettingsData carries it through, and buildSettingEmbed renders it instead of effectiveValue; fix the stale doc comment. Character dashboard resolves via cascadeResolver.resolveOverrides — same parent-snapshot concept relative to the tier being edited; enumerate all four resolve paths before building.

Acceptance: with an admin default of 30d and a user override of off, the drill-down shows Current Value Off and Parent Value 30 days; a test pins parent != effective for an overridden field; the SettingsDashboardBuilder comment no longer claims effectiveValue is the inherited value.
<!-- SECTION:DESCRIPTION:END -->
