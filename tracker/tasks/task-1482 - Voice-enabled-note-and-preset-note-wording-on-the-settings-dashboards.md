---
id: TASK-1482
title: Voice-enabled note and preset-note wording on the settings dashboards
status: To Do
assignee: []
created_date: '2026-11-20T06:37:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1482000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2773 review: (1) the VOICE_ENABLED_DESCRIPTION_NOTE ("enabled by its creator; /voice view shows whether it is") is also attached to the creator-tier /character settings dashboard, where it sends the creator in a circle; (2) the /settings defaults preset note is read once at open and rides the session, so it can name an old preset after /preset default set; (3) the fetchPresetNote JSDoc says the note is read from the same GET /preset default reads, but no read command exists (only set and clear).
What: drop or reword the note for the creator tier (point at the edit dashboard voice toggle); say snapshot at open time in the fetchPresetNote JSDoc and reword it to the default slot that /preset default set writes, read via getDefaultModelConfig.
Acceptance: creator dashboard wording is not circular; both JSDoc lines match the code.
<!-- SECTION:DESCRIPTION:END -->
