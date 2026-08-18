/**
 * Backfill of a forwarded message's recovered origin onto its persisted row.
 *
 * Split from the persist itself because recovering the origin costs Discord
 * REST round-trips (bot-client must re-fetch the message the forward points
 * at), and those cannot sit on the path that gates AI job submission. The row
 * is written first without attribution; this fills it in afterwards.
 *
 * CONSEQUENCE, stated rather than discovered later: the backfill races the
 * job it belongs to. The turn that created the forward may assemble its
 * context before this lands, so attribution shows up in `<chat_log>` for
 * SUBSEQUENT turns rather than the current one. That is inherent to resolving
 * off the blocking path and is the trade this design accepts.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type ForwardedOrigin } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ConversationHistoryClient } from './ConversationMessageMapper.js';

const logger = createLogger('ForwardedOriginWriter');

/**
 * A client that can additionally issue raw SQL.
 *
 * Separate from {@link ConversationHistoryClient} for the same reason
 * `TransactionalConversationHistoryClient` is: the capability is requested at
 * the signature that needs it rather than widened for everyone.
 */
export type RawCapableConversationHistoryClient = ConversationHistoryClient &
  Pick<PrismaClient, '$executeRaw'>;

/**
 * Merge `forwardedFrom` into a row's `message_metadata`.
 *
 * Raw SQL rather than a Prisma read-modify-write, and the reason is a
 * concurrency one rather than a performance one. `writeTriggerReferences` also
 * updates this column by reading the blob, spreading it, and writing it back —
 * its own comment notes that is only safe while it is the sole writer. This is
 * a second writer, so a read-modify-write here could interleave with that one
 * and drop whichever key lost the race. Postgres's `||` merges server-side in
 * one statement, so the two writers touch disjoint keys without ordering.
 *
 * `updated_at` is bumped EXPLICITLY because raw SQL bypasses Prisma's
 * `@updatedAt`, and `conversation_history` is sync-tracked — dev/prod
 * reconcile last-write-wins on that column, so leaving it stale would let a
 * sync silently revert this backfill. This is a semantic state change and
 * should win, which is exactly what `03-database.md` reserves the bump for.
 *
 * @returns true when a row was updated; false when none matched, which is an
 *   expected outcome (the persist is best-effort bot-side) and not an error.
 */
export async function mergeForwardedOrigin(
  prisma: RawCapableConversationHistoryClient,
  id: string,
  origin: ForwardedOrigin
): Promise<boolean> {
  try {
    // Serialized once so the parameter is a single jsonb value; the tagged
    // template parameterizes it, so no user-derived text reaches the SQL text.
    const patch = JSON.stringify({ forwardedFrom: origin });

    const rowsAffected = await prisma.$executeRaw`
      UPDATE conversation_history
      SET message_metadata = COALESCE(message_metadata, '{}'::jsonb) || ${patch}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}::uuid
    `;

    if (rowsAffected === 0) {
      logger.debug({ id }, 'No row matched the forwarded-origin backfill');
      return false;
    }
    return true;
  } catch (error) {
    // Attribution is an enrichment. Failing it must never propagate into a
    // path a user can feel — the quote simply renders unattributed, which is
    // what it did before this existed.
    logger.warn({ err: error, id }, 'Failed to back-fill forwarded origin');
    return false;
  }
}
