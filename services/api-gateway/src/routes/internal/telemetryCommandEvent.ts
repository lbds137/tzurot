/**
 * POST /api/internal/telemetry/command-event
 *
 * Service-only endpoint. Writes exactly one `command_events` row per slash
 * command / context-menu invocation, emitted fire-and-forget by bot-client's
 * dispatch choke points.
 *
 * The table records THAT a command ran — its dotted name, the outcome class,
 * how long it took, and a coarse location class — and never what was said.
 * No message content, no free text, no rendered error message (the caller
 * sends a stable machine code instead).
 *
 * **The context allowlist is the drift guard.** `context` arrives as an open
 * record and every key outside {@link TELEMETRY_CONTEXT_ALLOWLIST} is dropped
 * here, in code, before the insert. Enforcing it server-side rather than at
 * the schema means a future caller that starts attaching a new key cannot
 * widen the recorded surface by editing its own call site, and a mistake
 * degrades to a dropped key rather than a 400 on a path nobody awaits.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `app.use(requireServiceAuth())` in `api-gateway/src/index.ts`, which
 * gates every `/internal/*` route. Requests without a valid service secret
 * never reach this handler.
 *
 * A failed insert propagates out of the handler and `asyncHandler` turns it
 * into a 500 — the same shape every other internal write route has. The
 * fire-and-forget half of this contract lives on the CLIENT side; the server
 * still reports honestly.
 */

import { type Response, type RequestHandler } from 'express';
import {
  RecordCommandEventRequestSchema,
  RecordCommandEventResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-telemetry-command-event');

/**
 * The only keys allowed to reach the `context` JSONB column. Coarse technical
 * tags — nothing derived from message content. Widening this list is a
 * deliberate, reviewable act; that is the point of it living here.
 */
export const TELEMETRY_CONTEXT_ALLOWLIST = ['model_family', 'provider', 'voice_mode'] as const;

const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set(TELEMETRY_CONTEXT_ALLOWLIST);

/**
 * Drop every key outside the allowlist. Returns `undefined` — not an empty
 * object — when nothing survives, so a fully-stripped payload stores SQL NULL
 * rather than a `{}` that reads as "we recorded tags" in a query.
 *
 * The value type is the request schema's own scalar union rather than
 * `unknown`: it is what makes the result a legal Prisma JSON input without a
 * cast, and it is the half of the guard a key allowlist cannot provide (a
 * nested object under an allowlisted key would otherwise carry anything).
 *
 * Pinned by the smuggled-key test in the colocated spec.
 */
type TelemetryContextValue = string | number | boolean;

function stripToAllowlist(
  context: Record<string, TelemetryContextValue> | undefined
): Record<string, TelemetryContextValue> | undefined {
  if (context === undefined) {
    return undefined;
  }

  const kept: Record<string, TelemetryContextValue> = {};
  for (const [key, value] of Object.entries(context)) {
    if (ALLOWED_CONTEXT_KEYS.has(key)) {
      kept[key] = value;
    }
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** POST /api/internal/telemetry/command-event — record one command invocation. */
export const handleRecordCommandEvent = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req, res: Response) => {
    const parseResult = RecordCommandEventRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const event = parseResult.data;

    await prisma.commandEvent.create({
      data: {
        userId: event.userId,
        guildId: event.guildId ?? null,
        channelKind: event.channelKind,
        command: event.command,
        characterId: event.characterId ?? null,
        outcome: event.outcome,
        errorCode: event.errorCode ?? null,
        latencyMs: event.latencyMs,
        context: stripToAllowlist(event.context),
      },
    });

    // Command name and outcome only — the user and guild ids are recorded in
    // the row, and repeating them in the log widens the identifier surface
    // for no diagnostic gain.
    logger.debug({ command: event.command, outcome: event.outcome }, 'Recorded command event');
    sendContractSuccess(res, RecordCommandEventResponseSchema, { recorded: true });
  });
};
