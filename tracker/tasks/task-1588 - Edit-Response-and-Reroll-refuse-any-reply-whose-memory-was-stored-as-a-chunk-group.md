---
id: TASK-1588
title: >-
  Edit Response and Reroll refuse any reply whose memory was stored as a chunk
  group
status: To Do
assignee: []
created_date: '2026-11-28T14:57:00Z'
labels:
  - area:memory
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1578000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a long reply is stored as a chunk group (several memory rows sharing chunkGroupId, ai-worker PgvectorMemoryAdapter.ts:235-247). TASK-1582 r2 makes any chunk-group row under the trigger block both Edit Response and Reroll, because no code reassembles a group and compares it to the stored reply.
What: support chunk groups. Reroll removes the whole group when the reassembled text matches; Edit Response rewrites it (re-chunk and re-embed).
Acceptance: a long reply with a chunk-group memory can be edited and rerolled; a locked chunk still refuses.
<!-- SECTION:DESCRIPTION:END -->
