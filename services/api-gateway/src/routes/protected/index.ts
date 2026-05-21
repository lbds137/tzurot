/**
 * Protected Routes
 *
 * Route factories for endpoints that require service authentication
 * (mounted behind `requireServiceAuth()` in api-gateway/src/index.ts).
 * Sibling of `routes/public/` — same factory shape, different auth posture.
 */

export { createMetricsRouter } from './metrics.js';
export { createVoiceReferenceRouter } from './voiceReferences.js';
