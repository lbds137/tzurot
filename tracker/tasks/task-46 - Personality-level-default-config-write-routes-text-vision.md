---
id: TASK-46
title: 'Personality-level default config write routes (text + vision)'
status: To Do
assignee: []
created_date: '2026-06-28 00:00'
labels: []
dependencies: []
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Personality-level default config write routes (text + vision)

**Why:** `personality_default_configs` (text) and `personality_vision_default_configs` (vision) exist and are READ by the resolver cascade, but **no route writes either** today — there's no "set this personality's default text/vision config" API (only user-global + user-per-personality overrides have write paths). Surfaced during S2a route-threading exploration: the user-level vision writes (`defaultVisionConfigId` / `visionConfigId`) are S2b scope, but the personality-level default tables are a separate, pre-existing gap that applies to **text too** (not vision-specific). **Fix shape**: admin (or personality-owner) routes to write `PersonalityDefaultConfig` / `PersonalityVisionDefaultConfig` + the matching command. **Promote when**: a personality-default-config feature is scoped (not part of the current vision epic). Surfaced 2026-06-28 (S2a exploration). _(The route-layer kind-threading follow-up that lived here shipped in PR #1378 / S2a; the remaining vision-write paths are tracked in `active-epic.md` § S2b.)_
<!-- SECTION:DESCRIPTION:END -->
