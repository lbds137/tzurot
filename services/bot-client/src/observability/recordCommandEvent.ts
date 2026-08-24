/**
 * The gateway call behind command telemetry.
 *
 * Lives here rather than in `utils/gatewayServiceCalls.ts` — where the bot's
 * other service-to-service helpers sit — so the whole command-telemetry seam
 * (slot, classifiers, emission guard, wire call) reads as one module. The
 * split is also what keeps `gatewayServiceCalls.ts` inside its max-lines
 * budget without compacting any of its documentation.
 *
 * This is the AWAITABLE half: it resolves on both success and a
 * gateway-reported failure, and never rejects for an HTTP outcome (the typed
 * client returns a result envelope rather than throwing). Callers on the
 * interaction path must still go through {@link emitCommandEvent}, which adds
 * the sync-throw and unhandled-rejection guards.
 */

import { type RecordCommandEventRequestSchema } from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { z } from 'zod';
import { getServiceClient } from '../utils/gatewayClients.js';

const logger = createLogger('recordCommandEvent');

/** Wire shape for {@link recordCommandEvent} — derived from the route's own
 *  input schema so the two can never drift. */
export type RecordCommandEventRequest = z.input<typeof RecordCommandEventRequestSchema>;

/**
 * Record a command-invocation telemetry row (THAT a command ran — never what
 * was said). Logs on failure instead of throwing, so the interaction path
 * neither waits on nor fails for telemetry. The failure log carries the
 * command name and HTTP status only — never the userId or guildId, which
 * would widen the identifier surface in the log for no diagnostic gain.
 */
export async function recordCommandEvent(event: RecordCommandEventRequest): Promise<void> {
  const result = await getServiceClient().recordCommandEvent(event);
  if (!result.ok) {
    logger.warn(
      { command: event.command, status: result.status },
      'Failed to record command event'
    );
  }
}
