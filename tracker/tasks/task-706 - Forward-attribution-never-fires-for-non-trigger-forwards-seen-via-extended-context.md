---
id: TASK-706
title: >-
  Forward attribution never fires for non-trigger forwards seen via extended
  context
status: To Do
assignee: []
created_date: '2026-08-20 21:58'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 706000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner dev smoke 2026-08-20 (post-beta.205 code, request 38a58442-83c5-405d-8a6b-d1665884b2ce). A forward posted at 21:50Z in a non-activated channel rendered <quote type="forward" from="Unknown"> with no t= on the FOLLOWING turn — past the #2141 backfill race window. bot-client logged ZERO lines at 21:50 (log window verified 20:03-21:54), so the message was never processed and never persisted.

Mechanism (code-read, not runtime-traced): the history renderer (ai-worker conversationUtils.ts ~line 201) reads msg.messageMetadata?.forwardedFrom — persisted metadata. The only writer is bot-client ConversationPersistence.ts ~245 via resolveForwardedOrigin, which runs only when bot-client processes/persists the message. A forward that enters the prompt solely through the extended-context live Discord fetch has no DB row and no metadata, so attribution structurally cannot appear. The trigger path and the reference-crawl path (SnapshotFormatter) both resolve — those are fine; the 2026-08-18 Unknown sample predates the feature merge, so it is not counter-evidence.

Fix shape: resolve at extended-context conversion time — bot-client MessageContextBuilder has the fetched Discord Message (reference + snapshot) in hand and resolveForwardedOrigin is already in the same service; attach the resolved origin to the outgoing context entry so the worker renderer finds it where it already looks. One extra Discord fetch per forward-bearing fetched message, bounded by the fetch window; consider a short cache. Related, NOT the same: task-668 (channel-name enrichment on the resolver — applies to whichever paths run it).

Acceptance: a forward posted as a non-trigger message in a non-activated channel renders author + t= on subsequent turns; the trigger path is confirmed unregressed; the no-access/DM gating of task-668 still holds wherever the resolver newly runs.
<!-- SECTION:DESCRIPTION:END -->
