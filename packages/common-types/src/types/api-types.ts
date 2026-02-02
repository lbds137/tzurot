/**
 * Shared API Types
 *
 * Type definitions shared across services for API requests and responses.
 * Core types are now defined in schemas.ts using Zod and re-exported here.
 */

import { JobStatus } from '../constants/index.js';
import type { LLMGenerationResult } from './schemas.js';

// Re-export schema-derived types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  GenerateRequest,
  DiscordEnvironment,
  LoadedPersonality,
  MentionedPersona,
  ReferencedChannel,
  RequestContext,
  ReferencedMessage,
  StoredReferencedMessage,
  MessageMetadata,
  GenerationPayload,
  LLMGenerationResult,
  // History API types
  HistoryClearRequest,
  HistoryClearResponse,
  HistoryUndoRequest,
  HistoryUndoResponse,
  HistoryStatsQuery,
  HistoryStatsResponse,
  HistoryHardDeleteRequest,
  HistoryHardDeleteResponse,
} from './schemas.js';

// Re-export schemas for runtime validation
export {
  attachmentMetadataSchema,
  apiConversationMessageSchema,
  generateRequestSchema,
  discordEnvironmentSchema,
  loadedPersonalitySchema,
  mentionedPersonaSchema,
  referencedChannelSchema,
  requestContextSchema,
  referencedMessageSchema,
  storedReferencedMessageSchema,
  messageMetadataSchema,
  generationPayloadSchema,
  llmGenerationResultSchema,
  // History API schemas
  historyClearRequestSchema,
  historyClearResponseSchema,
  historyUndoRequestSchema,
  historyUndoResponseSchema,
  historyStatsQuerySchema,
  historyStatsResponseSchema,
  historyHardDeleteRequestSchema,
  historyHardDeleteResponseSchema,
} from './schemas.js';

/**
 * Response from /ai/generate endpoint
 *
 * Uses LLMGenerationResult (schema-derived) for the result field to provide
 * full error context (success, error, errorInfo, personalityErrorMessage)
 * while maintaining API contract consistency.
 */
export interface GenerateResponse {
  jobId: string;
  requestId: string;
  status: JobStatus;
  // When wait=true, includes the result directly (uses full LLMGenerationResult)
  result?: LLMGenerationResult;
  timestamp?: string;
}
