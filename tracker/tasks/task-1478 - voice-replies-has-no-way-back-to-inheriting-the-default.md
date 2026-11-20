---
id: TASK-1478
title: /voice replies has no way back to inheriting the default
status: To Do
assignee: []
created_date: '2026-11-20T06:36:00Z'
labels:
  - area:bot-client
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1478000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /voice replies offers always, voice-only and never. Once used, the user-personality override stays set, and the only way back to inheriting (channel, user default, character default) is the /character overrides dashboard reset.
Owner question: Should /voice replies gain a fourth choice that clears the override back to inherit?
Recommendation: yes, a "Default (inherit)" choice — the command is the discoverable path this PR added, so it should be able to undo itself.
<!-- SECTION:DESCRIPTION:END -->
