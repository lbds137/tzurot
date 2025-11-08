/**
 * Shared API Types
 *
 * Type definitions shared across services for API requests and responses.
 * Core types are now defined in schemas.ts using Zod and re-exported here.
 */

import { JobStatus } from '../config/constants.js';

// Re-export schema-derived types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  GenerateRequest,
  DiscordEnvironment,
  LoadedPersonality,
  RequestContext,
  ReferencedMessage,
} from './schemas.js';

/**
 * Response from /ai/generate endpoint
 */
export interface GenerateResponse {
  jobId: string;
  requestId: string;
  status: JobStatus;
  // When wait=true, includes the result directly
  result?: {
    content: string;
    attachmentDescriptions?: string;
    referencedMessagesDescriptions?: string; // Formatted reference text with vision/transcription
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
    referencedMessagesDescriptions?: string; // Formatted reference text with vision/transcription
    metadata?: {
      retrievedMemories?: number;
      tokensUsed?: number;
      processingTimeMs?: number;
      modelUsed?: string;
    };
  };
}
