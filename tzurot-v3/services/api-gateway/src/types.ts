/**
 * API Gateway Types
 *
 * Type definitions for API requests, responses, and internal structures.
 */

import type { MessageContent } from '@tzurot/common-types';

/**
 * Request body for /ai/generate endpoint
 * Uses a simplified personality type that matches validation schema
 */
export interface GenerateRequest {
  personality: {
    name: string;
    displayName?: string;
    systemPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    memoryEnabled?: boolean;
    contextWindow?: number;
    avatarUrl?: string;
  };
  message: MessageContent;
  context: {
    userId: string;
    userName?: string;
    channelId?: string;
    serverId?: string;
    sessionId?: string;
    isProxyMessage?: boolean;
    conversationHistory?: ConversationMessage[];
  };
  userApiKey?: string;
}

/**
 * Conversation message format
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Response from /ai/generate endpoint
 */
export interface GenerateResponse {
  jobId: string;
  requestId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    redis: boolean;
    queue: boolean;
  };
  timestamp: string;
  uptime: number;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;
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
