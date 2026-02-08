/**
 * API Gateway Types
 *
 * Type definitions for API responses and internal structures.
 * Request types are now in @tzurot/common-types for sharing across services.
 */

import type { Request } from 'express';
import type { HealthStatus } from '@tzurot/common-types';

// Re-export shared API types from common-types
export type { GenerateRequest, GenerateResponse } from '@tzurot/common-types';

/**
 * Standard error codes used across the API
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  JOB_FAILED = 'JOB_FAILED',
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  SYNC_ERROR = 'SYNC_ERROR',
  METRICS_ERROR = 'METRICS_ERROR',
}

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
