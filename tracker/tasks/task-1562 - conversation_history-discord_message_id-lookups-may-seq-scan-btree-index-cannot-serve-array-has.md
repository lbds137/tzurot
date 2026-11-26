---
id: TASK-1562
title: >-
  conversation_history discord_message_id lookups may seq-scan: btree index
  cannot serve array has
status: To Do
assignee: []
created_date: '2026-11-26T20:26:00Z'
labels:
  - area:db
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1556000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2819 review (nit 8). getMessageByDiscordId filters discordMessageId with Prisma has (array containment), and the only index is the btree @@index([discordMessageId]) on conversation_history (prisma/schema.prisma), which cannot serve @>. The lookup now has two more callers (Chime In and Edit Character context menus), plus reply resolution and DM session recovery. Unverified: no EXPLAIN run yet.

What: run EXPLAIN ANALYZE on the lookup against dev; if it seq-scans, add a GIN index (the memories.message_ids GIN is the precedent) in a migration with the query named per 03-database.md, and decide whether the btree stays.

Acceptance: EXPLAIN output recorded; the index lands with its query or the task closes with the plan showing an index scan.
<!-- SECTION:DESCRIPTION:END -->
