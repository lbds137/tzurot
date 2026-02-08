/**
 * API Gateway Types
 *
 * Type definitions for API responses and internal structures.
 * Request types are now in @tzurot/common-types for sharing across services.
 */

import type { Request } from 'express';
import type { ErrorCode } from './utils/errorResponses.js';
import type { HealthStatus } from '@tzurot/common-types';

// Re-export shared API types from common-types
export type { GenerateRequest, GenerateResponse } from '@tzurot/common-types';

// Re-export ErrorCode for convenience
export type { ErrorCode } from './utils/errorResponses.js';

/**
 * Express Request with authenticated user ID
 * Set by AuthMiddleware after Discord token validation
 */
export interface AuthenticatedRequest extends Request {
  userId: string; // Discord user ID
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: HealthStatus.Healthy | HealthStatus.Degraded | HealthStatus.Unhealthy;
  services: {
    redis: boolean;
    queue: boolean;
    avatarStorage?: boolean;
  };
  avatars?: {
    status: HealthStatus;
    count?: number;
    error?: string;
  };
  timestamp: string;
  uptime: number;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: ErrorCode;
  message: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Cached request for deduplication
 */
export interface CachedRequest {
  requestId: string;
  jobId: string;
  timestamp: number;
  expiresAt: number;
}
