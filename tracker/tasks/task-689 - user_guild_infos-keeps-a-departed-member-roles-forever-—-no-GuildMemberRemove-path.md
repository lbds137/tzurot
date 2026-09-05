---
id: TASK-689
title: >-
  user_guild_infos keeps a departed member roles forever — no GuildMemberRemove
  path
status: Done
assignee: []
created_date: '2026-08-19 23:47'
updated_date: '2026-09-05 04:54'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 689000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2153 review, medium severity. GuildMemberInfoReporter listens only for GuildMemberUpdate; there is no guildMemberRemove listener anywhere in bot-client (grep-confirmed), and no bot-left-guild path either. Combined with the deliberate no-expiry design (guildMemberInfoStore exports exactly record and read), a row for someone who has since LEFT the guild persists indefinitely with their last-known roles and colour.

Why it renders: roster MEMBERSHIP comes from DB chat history, not current Discord membership, so a departed member stays in participants as long as they are in the recent window — now decorated with roles they no longer hold.

What changed: before TASK-651 a departed member simply lost their guild info once they fell out of the per-turn fetch window. Absent was arguably wrong too, but it was not stale-but-plausible. The persistence traded one failure mode for a quieter one.

Owner decision, not an agent call, because it is user-visible: a character can describe someone by a role they were stripped of. Options: (a) accept it, on the grounds that the history window is short and roles rarely matter; (b) add a GuildMemberRemove handler that deletes the row through a new internal endpoint, mirroring the record path since bot-client cannot reach Prisma; (c) start reading observed_at, which already exists and is currently inert, and stop rendering past some age — weakest of the three, because it reintroduces exactly the vanish-on-lapse flicker TASK-651 removed.

Acceptance: a decision is recorded here with its reason.

## OWNER DECISION 2026-08-20

(a) accept for now — the history window is short and roles are rarely load-bearing — with (b) as the eventual fix: a GuildMemberRemove handler that deletes the row through a new internal endpoint, mirroring the record path (bot-client stays Prisma-free). (c) rejected: reintroduces the vanish-flicker TASK-651 removed. This task now tracks the (b) implementation; state flipped owner->ready, priority low to reflect 'eventual'.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner already decided (2026-08-20) on option (b) — a `GuildMemberRemove` handler deleting the row via a new internal endpoint — but it hasn't been built. Evidence: `grep -rn "guildMemberRemove\|GuildMemberRemove" services/bot-client/src --include=*.ts | grep -v test` → no hits anywhere in bot-client.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
