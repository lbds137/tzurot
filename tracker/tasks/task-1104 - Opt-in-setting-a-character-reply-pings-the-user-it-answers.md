---
id: TASK-1104
title: 'Opt-in setting: a character reply pings the user it answers'
status: To Do
assignee: []
created_date: '2026-09-25 17:07'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1097000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: user request (damien, #general, 2026-09-25 12:03): "how do i make it so my deities tag me when they reply, otherwise i forget i asked them something". The owner answered in-channel that there is no current way and it is probably not a big change. Character replies go out as webhook messages, so Discord never treats them as native replies with a reply ping; the user gets no notification that the answer arrived.

Fix shape: a per-user opt-in setting (default OFF, in the user settings dashboard alongside the other per-user toggles) that, when ON, has the character reply mention the asking user. Two halves: the send path (the webhook send that delivers a character turn) prepends or appends the <@userId> mention on the first chunk of the reply, and sets allowedMentions to users: [userId] for that send only. The bot client sends with allowedMentions parse: [] globally (services/bot-client/src/index.ts, grep allowedMentions), so the text alone would render as a mention but never notify; the allowlist for that one id is the mechanism. Scope decisions to settle before building: whether the ping applies to multi-tag fan-out slots (every slot or only the first), to DM replies (Discord notifies DMs anyway, so probably not), and to chime-ins the user did not address (probably not; only replies to a turn the user authored). Related: TASK-954 (the parked reply-ping gate) analyses how Discord populates mentions on replies; read it before choosing the discriminator.

Acceptance: with the setting ON, a character reply to the user notifies them (a mention that pings, verified in dev by the owner); with it OFF nothing changes; the setting round-trips through the dashboard and its update schema (the DASHBOARDS registry guard); docs/commands.md names the setting.
<!-- SECTION:DESCRIPTION:END -->
