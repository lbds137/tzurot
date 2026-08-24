/**
 * Fire-and-forget emission guard for command telemetry.
 *
 * {@link recordCommandEvent} already resolves rather than rejects on a
 * gateway failure, but the interaction-path caller runs it after the
 * dispatcher's try/catch, where a thrown error would still escape into
 * Discord's interaction handling. The `.catch()` contains the only failure
 * shape an `async` callee can produce: a rejection on the returned promise
 * (an async function never throws synchronously — its synchronous prefix,
 * including a throwing `getServiceClient()`, becomes a rejection). That is
 * also the load-bearing invariant: `recordCommandEvent` must STAY `async`,
 * because a non-async refactor would let a sync throw escape this seam into
 * Discord's interaction handling.
 *
 * Mirrors the `void stampUserActivity(...).catch(() => {...})` idiom used at
 * the fire-and-forget call site in `index.ts`.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { recordCommandEvent, type RecordCommandEventRequest } from './recordCommandEvent.js';

const logger = createLogger('emitCommandEvent');

/**
 * Emit a command-telemetry event without ever throwing into the caller —
 * neither synchronously nor via an unhandled promise rejection.
 */
export function emitCommandEvent(event: RecordCommandEventRequest): void {
  void recordCommandEvent(event).catch((err: unknown) => {
    // recordCommandEvent already logs a warn on a gateway-reported failure;
    // this only guards against a rejection the wrapper itself didn't catch
    // (e.g. a thrown error building the request inside the promise chain).
    logger.warn({ err, command: event.command }, 'Command event emission rejected');
  });
}
