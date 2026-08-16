---
id: TASK-635
title: Mid-stream multi-chunk send failure discards already-delivered chunk ids
status: To Do
assignee: []
created_date: '2026-08-16 23:44'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 635000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by the 2119 round-2 review. sendViaWebhook / sendViaDM (DiscordResponseSender.ts) push one id per chunk into a locally-scoped array; when chunk N (N>1) throws after earlier chunks succeeded, the exception propagates out of sendResponse and the caller never receives ANY ids - including those of chunks that really reached Discord. Every caller then persists nothing (or, on deliverError, falls back to a plain reply), so the delivered chunks are lost from history: exactly the delivered-but-unpersisted class TASK-626 reduced. The zero-ids-means-nothing-sent invariant holds only for the RETURN path; the throw path bypasses the empty-ids guard entirely. The pinning test comment in DiscordResponseSender.test.ts was corrected to state this honestly and points here.
Fix shape: surface partial progress on a mid-loop chunk failure - e.g. attach the delivered ids to the thrown error (a typed PartialDeliveryError) or return a partial result, and have callers persist what was delivered before taking their error path. Needs a small design decision about what the persisted partial turn should contain.
Acceptance: a 2-chunk send whose second chunk fails persists a history row carrying chunk 1 id; test pins it on both webhook and DM paths.
<!-- SECTION:DESCRIPTION:END -->
