/**
 * Middleware
 *
 * Express middleware for the API Gateway.
 */

export { createCorsMiddleware } from './cors.js';
export { notFoundHandler, globalErrorHandler } from './errorHandler.js';
