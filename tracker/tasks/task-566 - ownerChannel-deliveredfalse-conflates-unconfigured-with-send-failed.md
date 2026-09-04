---
id: TASK-566
title: ownerChannel delivered=false conflates unconfigured with send-failed
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
updated_date: '2026-09-04 19:37'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Still true — `postOwnerChannelEmbed` returns `false` for both the permanent unconfigured case and transient send failures, so an unconfigured deploy would re-run the full gateway check every tick forever. Evidence: `sed -n '1,50p' services/bot-client/src/utils/ownerChannel.ts` → both the `channelId === undefined` early return and the `catch` block return `false` with no distinguishing signal.
---
<!-- COMMENTS:END -->
