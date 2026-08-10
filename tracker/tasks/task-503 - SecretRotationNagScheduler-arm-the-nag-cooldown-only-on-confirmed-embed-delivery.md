---
id: TASK-503
title: >-
  SecretRotationNagScheduler: arm the nag cooldown only on confirmed embed
  delivery
status: To Do
assignee: []
created_date: '2026-08-10 10:50'
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
Fix shape: mirror ReleaseFlagNagScheduler runReleaseFlagNagCheck - const delivered = await postOwnerChannelEmbed(...); arm the cooldown only when delivered, warn-log otherwise so the next daily tick retries. One test: post reports non-delivery -> no setex.
Acceptance: a failed post does not arm secret-rotation-nag:cooldown; test pins it.
<!-- SECTION:DESCRIPTION:END -->
