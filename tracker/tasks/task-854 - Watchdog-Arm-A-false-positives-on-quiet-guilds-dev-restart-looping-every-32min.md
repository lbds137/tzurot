---
id: TASK-854
title: >-
  Watchdog Arm A false-positives on quiet guilds - dev restart-looping every
  32min
status: To Do
assignee: []
created_date: '2026-09-01 17:20'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 854000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shipped 15-min dispatch-staleness assumption is wrong for low-traffic guilds. Dev (1 silent guild) gets zero dispatches after the boot burst, so Arm A fires perpetually: alert at 16min (deferred by min-uptime gate), exit(1) at 32min, restart, repeat. Owner screenshots 2026-09-01 ~10:45-13:09 local show the loop; staleForMs tracks uptime minus ~2s on first alerts. Bonus defect: the alert webhook message lands in a bot-visible channel, generating MESSAGE_CREATE that resets the staleness clock and re-arms the episode latch - the watchdog feeds itself its only traffic. Prod would restart-loop through every quiet night, so this BLOCKS the beta.213 release.
Fix shape: Arm A staleness crossing triggers an active gateway probe instead of a wedge verdict - guild.members.fetch({query: "", limit: 1, time: graceMs}) sends op-8 RequestGuildMembers on the gateway socket (GuildMembers intent present, index.ts:157); the GUILD_MEMBERS_CHUNK dispatch resets the clock via the existing Events.Raw listener. Wedge = clock still climbing past threshold + grace with the probe outstanding. Arm B unchanged.
Acceptance: dev stops restart-looping (uptime grows past 32min with no alerts); a test pins probe-fired-not-exited at crossing, and wedge-confirmed after probe timeout.
<!-- SECTION:DESCRIPTION:END -->
