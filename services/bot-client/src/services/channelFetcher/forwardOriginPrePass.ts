/**
 * Forwarded-origin pre-pass for the extended-context fetch.
 *
 * Runs before the conversion loop rather than inside it: that loop awaits per
 * message, so resolving inline would serialize up to a window's worth of
 * Discord REST call pairs in front of a reply. Priming a bounded set in
 * parallel here leaves the conversion path a pure cache read, whose worst case
 * is zero added latency.
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isForwardedMessage } from '../../utils/forwardedMessageUtils.js';
import {
  primeForwardedOrigins,
  MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH,
} from '../../utils/forwardedOriginCache.js';
import type { FetchOptions } from './types.js';

const logger = createLogger('forwardOriginPrePass');

/**
 * Prime the forwarded-origin cache for the newest forwards in this window.
 *
 * No-ops when no resolver is wired or nothing in the window is forwarded, so
 * the common case costs one predicate pass and no network calls.
 *
 * @param sortedMessages - the window, OLDEST-first; the cap therefore keeps the
 * tail, which is the newest forwards. Anything past the cap renders
 * unattributed, exactly as it did before this pre-pass existed.
 *
 * A message primed here may still be dropped later by a conversion-loop filter
 * (block-denied, cutoff); that wastes at most a few bounded calls.
 */
export async function primeForwardOriginsForWindow(
  sortedMessages: Message[],
  options: FetchOptions
): Promise<void> {
  if (options.resolveForwardedAuthorPersonalityId === undefined) {
    return;
  }

  const forwarded = sortedMessages.filter(isForwardedMessage);
  if (forwarded.length === 0) {
    return;
  }

  const selected = forwarded.slice(-MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH);
  await primeForwardedOrigins(selected, options.resolveForwardedAuthorPersonalityId);

  logger.debug(
    {
      primedCount: selected.length,
      skippedByCapCount: forwarded.length - selected.length,
    },
    'Primed forwarded origins for extended context'
  );
}
