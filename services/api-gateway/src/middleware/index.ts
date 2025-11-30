/**
 * Middleware
 *
 * Express middleware for the API Gateway.
 */

export { createCorsMiddleware, type CorsConfig } from './cors.js';
export { notFoundHandler, globalErrorHandler } from './errorHandler.js';
