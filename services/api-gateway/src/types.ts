/**
 * API Gateway Types
 *
 * Type definitions for API responses and internal structures.
 * Request types are now in @tzurot/common-types for sharing across services.
 */

import type { ErrorCode } from './utils/errorResponses.js';

// Re-export shared API types from common-types
export type {
  GenerateRequest,
  GenerateResponse,
  ApiConversationMessage,
  AttachmentMetadata,
  JobResult,
} from '@tzurot/common-types';

// Re-export ErrorCode for convenience
export type { ErrorCode } from './utils/errorResponses.js';

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    redis: boolean;
    queue: boolean;
    avatarStorage?: boolean;
  };
  avatars?: {
    status: string;
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
