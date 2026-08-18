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

import { type ForwardedOrigin } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type RawCapableConversationHistoryClient } from './ConversationMessageMapper.js';
import { mergeMessageMetadata, type MessageMetadataMergeResult } from './messageMetadataMerge.js';

const logger = createLogger('ForwardedOriginWriter');

/**
 * Merge `forwardedFrom` into a row's `message_metadata`.
 *
 * Delegates to {@link mergeMessageMetadata} rather than issuing its own
 * UPDATE. That shared merge exists because this column has more than one
 * writer, each owning a different key of one JSON blob. This writer merged
 * server-side from the start; the reference write did not, so the race this
 * docstring used to describe as open on the other side was real. It is closed
 * now that every writer of this column goes through the shared merge.
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
): Promise<MessageMetadataMergeResult> {
  // Attribution is an enrichment: the shared merge swallows a DB error into
  // `failed` rather than throwing, which is what keeps a failure here off any
  // path a user can feel — the quote simply renders unattributed, as it did
  // before this existed.
  const result = await mergeMessageMetadata(
    prisma,
    id,
    { forwardedFrom: origin },
    { operation: 'forwarded-origin-backfill' }
  );

  if (result === 'missing') {
    logger.debug({ id }, 'No row matched the forwarded-origin backfill');
  }
  return result;
}
