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
 * Outcome of a backfill attempt.
 *
 * `missing` and `failed` are both "the quote stays unattributed", but they are
 * different events: one is the ordinary result of a best-effort persist not
 * having written the row, the other is a database problem. Collapsing them
 * into a boolean makes the caller's log a claim it cannot support.
 */
export type ForwardedOriginMergeResult = 'updated' | 'missing' | 'failed';

/**
 * Merge `forwardedFrom` into a row's `message_metadata`.
 *
 * Raw SQL rather than a Prisma read-modify-write, and the reason is a
 * concurrency one rather than a performance one. `writeTriggerReferences` also
 * updates this column by reading the blob, spreading it, and writing it back —
 * its own comment notes that is only safe while it is the sole writer. This is
 * a second writer, so a read-modify-write here could interleave with that one
 * and drop whichever key lost the race. Postgres's `||` merges server-side in
 * one statement, which removes that hazard from THIS side.
 *
 * It does NOT close the race from the other side, and saying so plainly
 * matters more than the reassurance: if `writeTriggerReferences` reads the row
 * before this UPDATE commits and writes after, its full-column overwrite
 * replaces the blob with a spread that never contained `forwardedFrom`, and
 * the key is gone with no error and no log. In practice this write lands
 * within a second of the persist while that one runs after the job resolves
 * references, so the normal ordering is safe — but ordering is not a
 * guarantee. Closing it structurally means making that writer merge too, which
 * needs a raw-capable client where its service deliberately holds a narrow
 * one; TASK-658 rather than widened here.
 *
 * `updated_at` is bumped EXPLICITLY because raw SQL bypasses Prisma's
 * `@updatedAt`, and `conversation_history` is sync-tracked — dev/prod
 * reconcile last-write-wins on that column, so leaving it stale would let a
 * sync silently revert this backfill. This is a semantic state change and
 * should win, which is exactly what `03-database.md` reserves the bump for.
 *
 * @returns `'updated'`, `'missing'` when no row matched (an expected outcome —
 *   the persist is best-effort bot-side — and not an error), or `'failed'` for
 *   a database error. The last two are distinguished rather than collapsed to
 *   `false` so a caller cannot report a DB failure as an ordinary absent row;
 *   both leave the quote unattributed, but only one is worth alerting on.
 */
export async function mergeForwardedOrigin(
  prisma: RawCapableConversationHistoryClient,
  id: string,
  origin: ForwardedOrigin
): Promise<ForwardedOriginMergeResult> {
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
      return 'missing';
    }
    return 'updated';
  } catch (error) {
    // Attribution is an enrichment. Failing it must never propagate into a
    // path a user can feel — the quote simply renders unattributed, which is
    // what it did before this existed.
    logger.warn({ err: error, id }, 'Failed to back-fill forwarded origin');
    return 'failed';
  }
}
