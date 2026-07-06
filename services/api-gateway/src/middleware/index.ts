/**
 * Middleware
 *
 * Express middleware for the API Gateway.
 */

export { createCorsMiddleware } from './cors.js';
export { allowCrossOriginEmbedding } from './crossOriginResource.js';
export { notFoundHandler, globalErrorHandler } from './errorHandler.js';
export { createMaintenanceMiddleware } from './maintenance.js';
