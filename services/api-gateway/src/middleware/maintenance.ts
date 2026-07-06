/**
 * Maintenance-Mode Middleware
 *
 * When the shared MaintenanceFlag is active, every request below this
 * middleware gets a clean 503 — so a destructive migration runs against a
 * quiesced API instead of surfacing Prisma errors on live traffic.
 *
 * Mount order matters: this sits AFTER `/health` (Railway's healthcheck must
 * keep passing or the platform restart-loops the service — the opposite of a
 * quiet window) and before everything else, so the whole surface (public
 * media, service-auth API) rejects uniformly.
 *
 * Fail-open is inherited from `MaintenanceFlag.isActive()` (a Redis outage
 * must not become a full API outage), so this middleware never throws on a
 * flag-read failure — it just proceeds.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { sendError } from '../utils/responseHelpers.js';
import { ErrorResponses } from '../utils/errorResponses.js';

/** Gateway-side maintenance message — clean JSON wording, no emojis (bot-client adds those). */
const MAINTENANCE_MESSAGE =
  'Tzurot is undergoing scheduled maintenance. Service will resume shortly.';

export function createMaintenanceMiddleware(flag: MaintenanceFlag): RequestHandler {
  // `_req` unused by design — the gate is request-agnostic; Express positional
  // signature requires the parameter.
  return (_req: Request, res: Response, next: NextFunction): void => {
    void flag
      .isActive()
      .then(active => {
        if (active) {
          sendError(res, ErrorResponses.serviceUnavailable(MAINTENANCE_MESSAGE));
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        // isActive fails open internally; this catch is a belt-and-suspenders
        // guard so an unexpected rejection can't hang the request chain.
        next(error);
      });
  };
}
