/**
 * Public Routes
 *
 * Routes that don't require authentication (health, avatars, exports).
 * Voice references moved to `routes/protected/` — they're only consumed
 * server-to-server by ai-worker, so the previous "intentionally
 * semi-public" posture invited slug-enumeration attacks for no gain.
 */

export { createHealthRouter } from './health.js';
export { createAvatarRouter } from './avatars.js';
export { createExportsRouter } from './exports.js';
export { createGitHubReleaseWebhookRouter } from './githubWebhook.js';
