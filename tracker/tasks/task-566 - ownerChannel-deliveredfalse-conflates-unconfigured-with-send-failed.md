---
id: TASK-566
title: ownerChannel delivered=false conflates unconfigured with send-failed
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 566000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: postOwnerChannelEmbed returns false both for the permanent no-channel-configured degrade and for transient send failures (ownerChannel.ts:34-45). Since #2045 arms cooldowns only on delivered, an unconfigured deploy runs the full retention/rotation gateway call + "will retry next tick" warn EVERY daily tick forever (latent - prod has the channel). Rider: a send that succeeds server-side but errors client-side also returns false and re-nags daily (bounded, arguably intended direction).

Fix shape: distinguish unconfigured (arm cooldown or skip the check) from send-failed (retry next tick).

Source: 2026-08-12 review, bot-client F3 CONFIRMED / F4 PLAUSIBLE.
<!-- SECTION:DESCRIPTION:END -->
