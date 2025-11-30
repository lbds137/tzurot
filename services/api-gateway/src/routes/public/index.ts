/**
 * Public Routes
 *
 * Routes that don't require authentication (health, metrics, avatars).
 */

export { createHealthRouter } from './health.js';
export { createMetricsRouter } from './metrics.js';
export { createAvatarRouter } from './avatars.js';
