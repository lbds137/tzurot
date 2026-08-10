---
id: TASK-503
title: >-
  SecretRotationNagScheduler: arm the nag cooldown only on confirmed embed
  delivery
status: Done
assignee: []
created_date: '2026-08-10 10:50'
updated_date: '2026-08-10 13:24'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 503000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: postOwnerChannelEmbed now returns a delivered boolean (added on PR #2038 for ReleaseFlagNagScheduler), but the secret-rotation nag still arms its weekly Redis cooldown unconditionally - a silently failed post (misconfigured channel, Discord API error) buys a week of silence on an overdue-rotation warning. Flagged by the #2038 review as present in both schedulers; fixed there for the new one only, to keep the PR scoped.

SCOPE WIDENED by the #2038 round-2 review: RetentionNagScheduler (RetentionNagScheduler.ts ~154-155) has the identical unconditional post-then-setex shape, so the sweep covers BOTH sibling schedulers, not just secret-rotation. Grep for other postOwnerChannelEmbed callers that arm a cooldown before starting, in case another lands meanwhile.

Fix shape: mirror ReleaseFlagNagScheduler runReleaseFlagNagCheck in each - const delivered = await postOwnerChannelEmbed(...); arm the cooldown only when delivered, warn-log otherwise so the next daily tick retries. One test per scheduler: post reports non-delivery -> no setex.
Acceptance: a failed post arms neither secret-rotation-nag:cooldown nor the retention nag cooldown; tests pin both.
<!-- SECTION:DESCRIPTION:END -->
