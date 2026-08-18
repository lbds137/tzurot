---
id: TASK-658
title: writeTriggerReferences read-modify-write can drop a sibling metadata key
status: To Do
assignee: []
created_date: '2026-08-18 14:10'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 658000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by review on PR #2141, which added a SECOND writer of conversation_history.message_metadata. mergeForwardedOrigin writes forwardedFrom with an atomic Postgres || merge, so it cannot clobber anyone. writeTriggerReferences still does a classic read-then-full-overwrite (packages/conversation-history/src/triggerReferenceWriter.ts:109-114): it reads messageMetadata, spreads it, and writes the whole column back.

The race: if the back-fill commits between that read and that UPDATE, the spread replaces the blob with a version that never contained forwardedFrom. The key vanishes with no error, no log, and no way to re-trigger the back-fill.

Normal ordering makes it unlikely -- the back-fill fires within a second of the persist while writeTriggerReferences runs after a job resolves references -- but ordering is not a guarantee, and the fallback path in findTriggerMessage (most-recent-row when the exact trigger id misses) widens the window to unrelated later turns.

Why it was NOT fixed in #2141: the fix is to merge server-side the way the other writer does, which needs a client carrying $executeRaw. ConversationHistoryService holds ConversationHistoryClient, a deliberately narrow type -- the api-gateway fast pool is constructed with it precisely so it cannot issue raw or transactional statements. Widening that is a shared-service type change with fast-pool blast radius, which is a risky-breadth reason rather than a convenience one.

Useful fact for whoever picks this up: storeTriggerReferences has exactly ONE caller (services/ai-worker/src/services/context/referencePersistence.ts:63), and ai-worker constructs the service with a full PrismaClient. So the capability is present at the only site that needs it -- the constraint is the declared type, not the runtime client.

Fix shape: generalize the merge in forwardedOriginWriter.ts into a shared mergeMessageMetadata(prisma, id, patch) and route both writers through it, threading a raw-capable client type only along the path that needs it.

Acceptance: both writers of message_metadata merge server-side; a test interleaves them on one row and asserts neither key is lost; the narrow client type still cannot reach raw SQL.
<!-- SECTION:DESCRIPTION:END -->
