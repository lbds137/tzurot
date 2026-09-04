---
id: TASK-688
title: >-
  guildMemberUpdate reporter has no debounce — a bulk role operation fans out
  one gateway call + one DB read per member
status: To Do
assignee: []
created_date: '2026-08-19 23:02'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 688000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of #2152 (round 2, low severity). GuildMemberInfoReporter filters updates that cannot change a rendered byte via rendersIdentically, but nothing batches or rate-limits beyond that. A bulk role operation — a reaction-role bot, a moderation sweep, a role rename cascading guildMemberUpdate per member — fires one internal HTTP call AND one prisma.user.findUnique per affected member, including the majority who have never touched the bot (the never-provisions design still queries before answering "no match").

Fine at current scale (single-owner bot, 28 unique users over the measured 30d), which is why this is filed rather than fixed.

Promote when: a guild with heavy role automation joins, or api-gateway/DB load shows bursts correlating with role churn. The observable is prod logs on the /internal/guild-member-info route.

Fix shape when it fires: coalesce per (guildId, userId) over a short window in bot-client before reporting, or batch the endpoint to accept multiple members per call. Prefer the bot-side coalesce — it also removes the DB read for unknown users, which is the larger cost.

Acceptance: a bulk role change on a large guild produces bounded gateway traffic rather than one call per member.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-688 finds it.
---
<!-- COMMENTS:END -->
