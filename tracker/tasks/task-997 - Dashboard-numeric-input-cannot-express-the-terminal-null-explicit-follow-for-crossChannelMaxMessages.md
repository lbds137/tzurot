---
id: TASK-997
title: >-
  Dashboard numeric input cannot express the terminal null (explicit follow) for
  crossChannelMaxMessages
status: To Do
assignee: []
created_date: '2026-09-16 22:55'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 993000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: crossChannelMaxMessages is a NULL_TERMINAL_FIELD whose stored null means follow maxMessages, and the gateway merge maps the wire sentinel CONFIG_WIRE_OFF (-1) to that null for any null-terminal field. But the dashboard numeric parser (services/bot-client/src/utils/dashboard/settings/settingsInputParser.ts parseNumericInputValue) maps auto and empty to null = clear override, and only the DURATION type ever emits the sentinel (its off branch). So when a higher tier (admin) sets a concrete cap, a lower tier cannot say follow maxMessages; auto inherits the ancestor number instead. Found by claude-review on PR #2442 (medium); the UI gap is real and the schema comment now states it.
Fix shape: add a keyword (follow, or reuse off with a field-specific label) to the numeric input path for null-terminal NUMERIC fields — parseNumericInputValue needs the field or a flag to know the sentinel is legal — and map it to CONFIG_WIRE_OFF in mapSettingToApiUpdate the way maxAge is special-cased (settingsUpdate.ts). Update the placeholder and helpText for the cap row. Pin with parser tests (follow → -1 for the cap; follow rejected for a plain NUMERIC like maxImages) and a mapSettingToApiUpdate case.
Acceptance: a channel-tier user can set Cross-Channel Max Messages to follow while the admin tier holds a number, and the resolved value is null (follow); the schema comment on the field is updated to drop the UI caveat.
Filed from PR #2442 round 1, 2026-09-16.
<!-- SECTION:DESCRIPTION:END -->
