/**
 * User-audience feedback intake route.
 *
 * Single POST: the abuse gates (cooldown, daily cap, dedupe) run server-side
 * and reject with gate-specific 400 messages the command renders verbatim.
 */

import {
  SubmitFeedbackInputSchema,
  SubmitFeedbackResponseSchema,
} from '@tzurot/common-types/schemas/api/feedback';
import type { RouteDef } from '../types.js';

export const userFeedbackRoutes = {
  /**
   * Submit feedback. NO atMostOnce: a SEQUENTIAL retry after a network blip
   * is absorbed by the server-side dedupe gate rather than double-storing.
   * (Concurrent duplicates can race the check-then-insert — accepted gap,
   * bounded by the daily cap; tracked in cold/follow-ups.md.)
   */
  submitFeedback: {
    audience: 'user',
    method: 'post',
    path: '/feedback',
    id: 'submitFeedback',
    input: SubmitFeedbackInputSchema,
    output: SubmitFeedbackResponseSchema,
    requiresProvisionedUser: true,
  },
} as const satisfies Record<string, RouteDef>;
