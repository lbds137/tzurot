---
id: TASK-1174
title: Import an external conversation as long-term memories for one character
status: To Do
assignee: []
created_date: '2026-10-05 00:11'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner wants a 45-turn conversation with her Lilith character (lilith-tzel-shani), held outside the bot and dated 2025-05-17, to become part of what the character remembers. Asked via the Characters session 2026-10-04.
Findings (code read 2026-10-04): there is no path that imports external turns. conversation_history is the wrong target: ConversationRetentionService.cleanupOldHistory (packages/conversation-history/src/ConversationRetentionService.ts:156, scheduled from services/ai-worker/src/jobs/scheduledJobDispatch.ts:55) hard-deletes rows past CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY = 30 (packages/common-types/src/constants/timing.ts:219), so 2025 rows would be purged on the next sweep, and history rows need a channelId the conversation never had. Long-term memory is the durable target and has two precedents: ShapesImportMemories (services/ai-worker/src/jobs/ShapesImportMemories.ts) writes Memory rows with the source createdAt and a sourceSystem tag; backfill-ltm (packages/tooling/src/memory/backfill-ltm.ts) pairs user/assistant turns in the LongTermMemoryService format, embeds them locally, and inserts idempotently with deterministic UUIDs.
What: an ops command that reads a JSON file of ordered {role, text, timestamp} turns, pairs each prompt with its reply in the LongTermMemoryService format, sets createdAt to the PROMPT timestamp (so the reply-timestamp gap in the source does not matter), tags sourceSystem as an external import, embeds, and inserts idempotently for one personality and the owner persona; dry run by default, dev first, prod only with an explicit go.
Check before building: whether the archive-summary, digest and fact-extraction jobs pick up imported memory rows (and whether that is wanted), and how recall renders a 2025 createdAt ("N days ago" phrasing).
Privacy: the source file is private and explicit in places; it stays outside the repo (owner private repos or the job scratch dir), is never committed, and the command never logs content (contentPreview rules).
Acceptance: a dry run on dev prints the pair count and date range; an apply writes that many rows; a re-run writes 0; a recall test in dev surfaces an imported memory.
<!-- SECTION:DESCRIPTION:END -->
