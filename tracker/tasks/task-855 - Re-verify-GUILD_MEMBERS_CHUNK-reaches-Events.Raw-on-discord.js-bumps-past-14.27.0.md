---
id: TASK-855
title: >-
  Re-verify GUILD_MEMBERS_CHUNK reaches Events.Raw on discord.js bumps past
  14.27.0
status: To Do
assignee: []
created_date: '2026-09-01 18:09'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 855000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2287 watchdog probe rests on an internal, undocumented discord.js coupling - a GUILD_MEMBERS_CHUNK dispatch fires the raw event listener (WebSocketManager.js:233 in 14.27.0), which is what resets the watchdog staleness clock after a liveness probe. CI fully mocks guild.members.fetch, so a discord.js bump that changes this wiring passes CI clean while silently reintroducing the quiet-guild restart loop TASK-854 fixed. Raised by claude-review on PR 2287 (finding 1, Low).
Fix shape: when a dependabot PR bumps discord.js past 14.27.0, re-read the installed WebSocketManager dispatch path and confirm raw still fires for GUILD_MEMBERS_CHUNK; note the check in that PR. If the coupling breaks, the watchdog probe needs a different reset mechanism (e.g. resetting the clock from the probe .then directly - currently deliberately NOT done to keep one clock-reset path).
Acceptance: the verification is performed and recorded on the first discord.js bump PR after 14.27.0.
<!-- SECTION:DESCRIPTION:END -->
