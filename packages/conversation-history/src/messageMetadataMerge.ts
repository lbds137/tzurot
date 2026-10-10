/**
 * The server-side merge into `conversation_history.message_metadata`.
 *
 * Two writers key on different fields of the same JSON blob: the
 * forwarded-origin backfill owns `forwardedFrom`, the built-references write
 * owns `referencedMessages`. A read-modify-write is safe only for a SOLE
 * writer — if the other commits between the read and the UPDATE, the spread
 * writes back a blob that never contained its key, and it is gone with no
 * error and no log. Postgres's `||` merges server-side in one statement,
 * which removes the hazard entirely rather than narrowing the window.
 *
 * Every UPDATE of this column must come through here. Row CREATION is the one
 * exception: `ConversationHistoryService.addMessage` sets `messageMetadata`
 * in its `create()`. Creation cannot race the FIRST write because the row does
 * not exist until `create()` returns; the safety of that path rests on
 * bot-client awaiting the persist before the message id is shared onward (an
 * assumption this package does not enforce; the row id is publicly
 * re-derivable, so non-existence is not a secrecy guarantee). What the
 * invariant forbids is a second read-modify-write of an EXISTING row. The
 * client type does not prevent one — it exposes the full
 * `conversationHistory.update()` — so the lint rule
 * `@tzurot/no-message-metadata-rmw` rejects `messageMetadata` in
 * update/updateMany/updateManyAndReturn/upsert payloads. "Every UPDATE must
 * come through here" is enforced only for Prisma-client payloads written
 * literally in the call; the rule's header lists what it cannot see (variables,
 * spreads, nested relation writes, aliased receivers, dynamic computed keys,
 * raw SQL).
 *
 * A stored value that is not a JSON object is replaced by `{}` before the
 * merge, so real array or scalar data in the column would be discarded
 * silently. That is intentional: the column's application type is an object,
 * so a non-object value is already corrupt.
 */

import { type MessageMetadata } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type RawCapableConversationHistoryClient } from './ConversationMessageMapper.js';

const logger = createLogger('MessageMetadataMerge');

/**
 * Outcome of a merge attempt.
 *
 * `missing` and `failed` are both "the write did not land", but they are
 * different events: one is the ordinary result of the target row not existing,
 * the other is a database problem. Collapsing them into a boolean makes the
 * caller's log a claim it cannot support.
 */
export type MessageMetadataMergeResult = 'updated' | 'missing' | 'failed';

/**
 * Merge `patch` into a row's `message_metadata`, touching nothing else.
 *
 * `updated_at` is bumped EXPLICITLY because raw SQL bypasses Prisma's
 * `@updatedAt`, and `conversation_history` is sync-tracked — dev/prod reconcile
 * last-write-wins on that column, so leaving it stale would let a sync silently
 * revert the write. These are semantic state changes and should win, which is
 * exactly what `03-database.md` reserves the bump for.
 *
 * @param patch - The keys to set. Merged shallowly at the TOP level only —
 *   `||` replaces a key's whole value rather than deep-merging it, so a caller
 *   owning a nested object must pass that object complete. It also cannot
 *   REMOVE a key: `||` adds and replaces, and a patch of `{k: null}` stores a
 *   JSON null rather than dropping `k`. No writer needs deletion today (every
 *   field in `messageMetadataSchema` is optional, and both writers only add
 *   their own key); one that does would need `- 'k'`, not this function.
 */
export async function mergeMessageMetadata(
  prisma: RawCapableConversationHistoryClient,
  id: string,
  patch: MessageMetadata,
  context: { operation: string }
): Promise<MessageMetadataMergeResult> {
  try {
    // Serialized once so the parameter is a single jsonb value; the tagged
    // template parameterizes it, so no user-derived text reaches the SQL text.
    const serialized = JSON.stringify(patch);

    const rowsAffected = await prisma.$executeRaw`
      UPDATE conversation_history
      SET message_metadata = CASE WHEN jsonb_typeof(message_metadata) = 'object'
                                  THEN message_metadata ELSE '{}'::jsonb END
                             || ${serialized}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}::uuid
    `;

    return rowsAffected === 0 ? 'missing' : 'updated';
  } catch (error) {
    logger.warn({ err: error, id, operation: context.operation }, 'Metadata merge failed');
    return 'failed';
  }
}
