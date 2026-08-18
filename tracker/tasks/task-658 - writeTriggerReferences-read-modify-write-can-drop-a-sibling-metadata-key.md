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

## SCOPE CORRECTION 2026-08-18 (found while grounding, before any code was written)

There are THREE writers of this column, not two. The third is
ConversationHistoryService.updateLastUserMessage
(packages/conversation-history/src/ConversationHistoryService.ts:262-277), which does
the identical read-then-full-overwrite: it reads target.messageMetadata via
findTriggerMessage, spreads it, and writes the whole column back.

The triggerReferenceWriter comment says "do not add a third writer of this column
before it lands" -- that third writer already existed, in the same package, one file
over. Enumerated mechanically rather than by memory:
grep -n "messageMetadata:" packages/conversation-history/src/*.ts returns exactly
these two write sites (triggerReferenceWriter.ts:120 and
ConversationHistoryService.ts:275) plus the mapper/select reads.

This makes the race WORSE than the original filing describes. Both post-AI writers
run seconds after the turn, while mergeForwardedOrigin backfills within a second of
the persist -- so BOTH of them can clobber forwardedFrom, not just one. They also
target the same rows: forwardedFrom lands on the trigger USER row, which is exactly
what findTriggerMessage resolves.

updateLastUserMessage is NOT a pure metadata merge and cannot use the same helper
unchanged: it writes content and token_count in the same UPDATE. The shared merge
either takes an optional column set, or that call site gets its own raw statement
writing all three plus updated_at. Decide when building; do not assume the
forwardedOrigin helper drops in.

Acceptance (REVISED -- the original said "both writers"): ALL THREE writers of
message_metadata merge server-side; a test interleaves them on one row and asserts
no key is lost; the narrow client type still cannot reach raw SQL.

Design settled while grounding (2026-08-18), to avoid the widening the original
filing feared: make ConversationHistoryService generic on its client with the narrow
type as the DEFAULT, and gate the raw-requiring methods with an explicit `this`
parameter -- `async storeTriggerReferences(this: ConversationHistoryService<RawCapableConversationHistoryClient>, ...)`.
Every existing narrow construction (four in api-gateway) compiles untouched, and
calling a raw-requiring method on a narrow instance becomes a COMPILE error rather
than a runtime surprise -- which is the acceptance clause enforced by the type system
instead of by convention. Measured blast radius: the class plus one annotation in
services/ai-worker/src/services/context/referencePersistence.ts. Verified: ai-worker
constructs the service with a full PrismaClient at ConversationalRAGService.ts:106,
so the capability is present where it is needed.

Bonus simplification: with a server-side merge, findTriggerMessage no longer needs to
return messageMetadata at all for the reference path -- the read that CREATES the race
stops existing rather than being protected.

## SECOND SCOPE CORRECTION 2026-08-18 (the first one was wrong)

There are TWO writers of this column, not three. The scope correction above counted
updateLastUserMessage as the third by grepping write sites -- but that site writes
messageMetadata only when its optional `newMetadata` argument is supplied, and NO
production caller has ever supplied it. Verified two ways: a repo-wide grep for
`newMetadata` returns only the function itself and tests, and
`git log -S"newMetadata" --all -- services/` returns nothing at all, so no service
has ever passed it in the project's history.

That correction was the exact failure 00-critical.md names -- "present and wired in
code is not live at runtime". A grep for write SITES found a site; it did not ask
whether the site can fire.

What shipped instead, which is a stronger fix than converting a third writer:

- mergeForwardedOrigin -- already merged server-side.
- writeTriggerReferences -- now merges server-side via the shared mergeMessageMetadata,
  and no longer reads the column at all. Not reading is a stronger guarantee than
  reading carefully.
- updateLastUserMessage -- the dead `newMetadata` capability is REMOVED. It writes
  content and token_count only, so it is not a writer of this column and cannot
  silently become one. Removing the parameter prevents the third writer rather than
  fixing it.

Also dropped as a consequence: mergeMessageContentAndMetadata (no caller once the
metadata half of that write went away), and ConversationalRAGService's private
`history` field (constructed solely for the reference persist, which is now a free
function taking prisma directly).

The capability split follows the existing precedent rather than the generic-class
design settled above -- that design was probed and DOES NOT ENFORCE, because TClient
appears only in a private field. RawCapableConversationHistoryClient now sits in
ConversationMessageMapper.ts beside TransactionalConversationHistoryClient, asked for
at the one signature that needs it, and clientCapability.test.ts gates it with
@ts-expect-error assertions checked by typecheck:spec -- which is real enforcement.

Acceptance (FINAL): both live writers of message_metadata merge server-side; a PGLite
component test interleaves them on one row and asserts no key is lost (proved able to
fail by mutating the merge to an overwrite); the narrow client type still cannot reach
raw SQL, gated at compile time.
<!-- SECTION:DESCRIPTION:END -->
