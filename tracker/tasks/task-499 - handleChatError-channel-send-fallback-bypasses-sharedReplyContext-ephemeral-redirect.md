---
id: TASK-499
title: >-
  handleChatError channel-send fallback bypasses sharedReplyContext ephemeral
  redirect
status: To Do
assignee: []
created_date: '2026-08-10 00:12'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 499000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by claude-review on PR #2034 (non-blocking). In the tag fan-out, per-character errors surface via sharedReplyContext (editReply redirected to ephemeral followUp). But characterTurn handleChatError has a catch-all fallback that posts directly to the real channel when editReply/followUp itself throws - so a DOUBLE failure (turn error + the redirected followUp throwing) posts a generic error publicly instead of privately to the invoker. Pre-existing handleChatError behavior reached through the new call path; requires two independent failures, so very low likelihood.
Fix shape: teach the fallback to respect the context view (e.g. a channelSend member on the context that sharedReplyContext can also redirect or suppress), or gate the channel fallback on a flag the fan-out clears. Read handleChatError first - the fallback exists for real delivery failures on the single-character path and must keep working there.
Acceptance: a test in chimeInTag.test.ts where the turn errors AND the redirected followUp rejects, asserting nothing posts to the raw channel.
<!-- SECTION:DESCRIPTION:END -->
