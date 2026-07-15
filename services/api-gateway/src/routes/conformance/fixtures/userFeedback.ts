/**
 * Conformance fixture: user feedback intake.
 *
 * Runs for real over the harness (PGLite + mock Redis) — the gates all pass
 * on a fresh submission, so no seed is needed.
 */

import type { ConformanceEntry } from './types.js';

export const userFeedbackFixtures: Record<string, ConformanceEntry> = {
  submitFeedback: {
    body: { content: 'conformance feedback submission' },
    status: 201,
  },
};
