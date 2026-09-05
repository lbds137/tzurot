---
id: TASK-895
title: Size the worst-case channel-wide history purge before it meets a large channel
status: To Do
assignee: []
created_date: '2026-09-05 04:35'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 893000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /history purge scope:everyone (#2339) runs ConversationRetentionService.clearHistory with no persona filter, so deleteMessagesInBatches (grep -n "deleteMessagesInBatches" packages/conversation-history/src/ConversationRetentionService.ts) now loops over every user rows for the character in that channel instead of one user rows, and each batch also propagates to memories. The loop is bounded per batch but not in total, and it runs inside the modal-submit request: if the typed-client call times out on bot-client, the gateway keeps deleting while the user is told the purge failed, and a retry re-runs it against what is left. Surfaced by claude-review round 2 on #2339; not measured.

Fix shape, measurement first: on prod, query the largest (channel, personality) message count and the p95 (a bounded GROUP BY over the history table via pnpm ops db:query or the equivalent read path), then compare against the per-batch cost the existing per-user purge shows in logs. If the worst case fits comfortably inside the client timeout (packages/clients/src/clients/transport.ts names it), record the numbers here and archive. If not: move the channel-wide arm to a BullMQ job that reports progress, and have the command reply with a job-started notice plus a follow-up on completion.

Acceptance: the numbers are on this task, and either the archive note or the job-based arm exists.
<!-- SECTION:DESCRIPTION:END -->
