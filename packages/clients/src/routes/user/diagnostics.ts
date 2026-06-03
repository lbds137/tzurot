/**
 * User-audience diagnostic routes.
 *
 * Diagnostic GETs were lifted from /admin per the route-prefix cutover.
 * Owner can pass ?userId=<subject> to inspect another user's logs;
 * non-owners' subject parameter is ignored server-side. Subject's row
 * may not be provisioned — these routes do NOT requireProvisionedUser.
 *
 * Mounted at `/api/user/diagnostic/*`. The generated `UserClient`
 * exposes them with `subject?: SubjectDiscordId` thanks to acceptsSubject.
 */

import { z } from 'zod';
import {
  DiagnosticLogResponseSchema,
  DiagnosticLogsResponseSchema,
  RecentDiagnosticLogsResponseSchema,
} from '@tzurot/common-types';
import type { RouteDef } from '../types.js';

export const userDiagnosticRoutes = {
  getRecentDiagnostics: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/recent',
    id: 'getRecentDiagnostics',
    // Note: the server handler reads `?userId=` for the subject — that's
    // what `acceptsSubject: true` maps to in the generated client (the
    // `options.subject` parameter). DO NOT also declare `userId` in
    // `query` here — the codegen would emit two `['userId', ...]`
    // entries into URLSearchParams.set, and the second would silently
    // overwrite the typed subject branding (defeating the whole point).
    // The cross-audience invariant test enforces this.
    query: { personalityId: z.string().optional() },
    output: RecentDiagnosticLogsResponseSchema,
    acceptsSubject: true,
    meta: { safeRead: true },
  },

  getDiagnosticByMessage: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/by-message/:messageId',
    id: 'getDiagnosticByMessage',
    params: { messageId: z.string() },
    output: DiagnosticLogsResponseSchema,
    acceptsSubject: true,
    meta: { safeRead: true },
  },

  getDiagnosticByResponse: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/by-response/:messageId',
    id: 'getDiagnosticByResponse',
    params: { messageId: z.string() },
    output: DiagnosticLogResponseSchema,
    acceptsSubject: true,
    meta: { safeRead: true },
  },

  getDiagnosticByRequestId: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/:requestId',
    id: 'getDiagnosticByRequestId',
    params: { requestId: z.string() },
    output: DiagnosticLogResponseSchema,
    acceptsSubject: true,
    meta: { safeRead: true },
  },
} as const satisfies Record<string, RouteDef>;
