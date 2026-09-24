---
id: TASK-1080
title: >-
  Channel settings dashboard drops its No character activated note after the
  first interaction
status: To Do
assignee: []
created_date: '2026-09-24 14:11'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1073000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by the doc-72 PR A orchestrator (2026-09-24). The channel settings dashboard renders a "No character activated" note on its opening message, but the settings router re-renders with the base CHANNEL_SETTINGS_CONFIG (services/bot-client/src/commands/channel/settings.ts), so the note disappears on the first interaction. Before PR A the first interaction was usually a drill-in; with the concern-page split it is usually Next, so the note now vanishes one tap in. The bug is older than PR A.
Fix shape: have the router rebuild the per-invocation config the opening render used (or carry the activation state in the session), so every re-render of that dashboard shows the note. The settings router file is at its ESLint line budget after PR A, so pair this with doc-72 PR B, which needs an extraction from that file anyway.
Acceptance: open channel settings in a channel with no activated character, press Next and drill in and back; the note shows on every render; a router test pins it.
<!-- SECTION:DESCRIPTION:END -->
