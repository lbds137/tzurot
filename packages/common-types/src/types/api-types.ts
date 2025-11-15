/**
 * Shared API Types
 *
 * Type definitions shared across services for API requests and responses.
 * Core types are now defined in schemas.ts using Zod and re-exported here.
 */

import { JobStatus } from '../constants/index.js';
import type { GenerationPayload } from './schemas.js';

// Re-export schema-derived types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  GenerateRequest,
  DiscordEnvironment,
  LoadedPersonality,
  RequestContext,
  ReferencedMessage,
  GenerationPayload,
  LLMGenerationResult,
} from './schemas.js';

// Re-export schemas for runtime validation
export {
  attachmentMetadataSchema,
  apiConversationMessageSchema,
  generateRequestSchema,
  discordEnvironmentSchema,
  loadedPersonalitySchema,
  requestContextSchema,
  referencedMessageSchema,
  generationPayloadSchema,
  llmGenerationResultSchema,
} from './schemas.js';

/**
 * Response from /ai/generate endpoint
 *
 * Uses GenerationPayload (schema-derived) for the result field to ensure
 * consistency with internal job results while maintaining API contract independence.
 */
export interface GenerateResponse {
  jobId: string;
  requestId: string;
  status: JobStatus;
  // When wait=true, includes the result directly (uses shared GenerationPayload)
  result?: GenerationPayload;
  timestamp?: string;
}
