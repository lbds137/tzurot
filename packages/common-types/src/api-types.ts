/**
 * Shared API Types
 *
 * Type definitions shared across services for API requests and responses.
 * Core types are now defined in schemas.ts using Zod and re-exported here.
 */

// Re-export schema-derived types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  GenerateRequest,
  DiscordEnvironment,
  PersonalityConfig,
  RequestContext,
  ReferencedMessage
} from './schemas.js';

/**
 * Response from /ai/generate endpoint
 */
export interface GenerateResponse {
  jobId: string;
  requestId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  // When wait=true, includes the result directly
  result?: {
    content: string;
    attachmentDescriptions?: string;
    metadata?: {
      retrievedMemories?: number;
      tokensUsed?: number;
      processingTimeMs?: number;
      modelUsed?: string;
    };
  };
  timestamp?: string;
}

/**
 * Job result from queue/gateway
 * Used by bot-client when polling or receiving results
 */
export interface JobResult {
  jobId: string;
  status: string;
  result?: {
    content: string;
    attachmentDescriptions?: string; // Rich text descriptions from vision/transcription
    metadata?: {
      retrievedMemories?: number;
      tokensUsed?: number;
      processingTimeMs?: number;
      modelUsed?: string;
    };
  };
}
