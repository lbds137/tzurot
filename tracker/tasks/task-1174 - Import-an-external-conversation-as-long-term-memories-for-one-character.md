---
id: TASK-1174
title: Import an external conversation as long-term memories for one character
status: To Do
assignee: []
created_date: '2026-10-05 00:11'
updated_date: '2026-10-05 00:20'
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
Verification is load-bearing (owner, via Characters 2026-10-04): the external copy is deleted only after this passes and the owner says so. The command ships a --verify read-back (read-only transaction) that checks, per environment: (a) rows tagged with this import equal the pair count in the file; (b) each row content equals the formatted pair rebuilt from the file text byte for byte; (c) each createdAt equals its prompt timestamp to the millisecond; (d) personalityId is lilith-tzel-shani and personaId is the owner persona. It prints a per-check pass/fail plus mismatching pair indexes (never content). Run on dev after apply and again on prod after the prod apply; send the result lines to the Characters session, which cross-checks against the file before anyone reports verified to the owner.
Schedule: whenever convenient (owner). Blocked until the Characters session delivers the source file (pending a Chats-session check of two edited prompts). Dev apply first; prod apply only on the owner explicit go at apply time.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Source file delivered 2026-10-04 by the Characters session: ~/Projects/tzurot-characters/export/gemini-lilith-2025-05-17/import.json (private repo main f392579, sha256 94405a301694727a6fbfa125ca1fd27c46415d64b7e1a43055f0e7c4f6b6a6a6, re-hashed here). 88 messages = 44 strictly alternating user/assistant pairs; user timestamps unique and ascending (jq-checked); assistant turns carry their prompt timestamp. User texts are whitespace-trimmed; six end with an owner-chosen "[Lila attached an image: ...]" marker line. Read in place; never copy into this repo.
<!-- SECTION:NOTES:END -->
