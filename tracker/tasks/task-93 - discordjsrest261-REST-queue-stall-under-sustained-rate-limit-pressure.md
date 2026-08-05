---
id: TASK-93
title: '@discordjs/rest@2.6.1 REST queue stall under sustained rate-limit pressure'
status: To Do
assignee: []
created_date: '2026-05-08 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:jobs'
  - 'area:bot-client'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`@discordjs/rest@2.6.1` REST queue stall under sustained rate-limit pressure

**Why:** Root cause of voice-transcription hang fixed in PR #1000 was `await channel.sendTyping()` blocking forever when discord.js's REST queue stalled. PR's fire-and-forget + ESLint guard prevents whole-pipeline hangs on this class of bug, but the underlying queue stall is unexplained upstream behavior. **Investigation shape**: (a) reproduce by hammering `sendTyping` against single channel under rate-limit pressure; (b) structured logging around `RequestManager` queue depth + retry counts; (c) check `@discordjs/rest@2.7.x` changelogs for queue-stall fixes; (d) decide upgrade vs. `Promise.race` timeout helper for all REST calls. **Why deferred**: blast radius — touches every REST call pattern, not just `sendTyping`. **Promote when**: another hang of the same class surfaces against a different REST endpoint, OR opportunistic during next discord.js dependency bump. Surfaced 2026-05-08. Deferred 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->
