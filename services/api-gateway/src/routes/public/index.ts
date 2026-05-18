/**
 * Public Routes
 *
 * Route factories grouped here for historical reasons. Most are mounted
 * publicly (health, avatars, voice-references, exports), but `metrics`
 * is mounted behind service auth despite living in this directory — the
 * factory shape is identical, only the mount-point auth posture differs.
 */

export { createHealthRouter } from './health.js';
export { createMetricsRouter } from './metrics.js';
export { createAvatarRouter } from './avatars.js';
export { createVoiceReferenceRouter } from './voiceReferences.js';
export { createExportsRouter } from './exports.js';
