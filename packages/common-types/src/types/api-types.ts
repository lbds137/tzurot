/**
 * Shared API Types
 *
 * Type definitions shared across services for API requests and responses.
 * Core types are now defined in schemas.ts using Zod and re-exported here.
 */

import { type JobStatus } from '../constants/index.js';
import type { LLMGenerationResult } from './schemas/index.js';
import type { AudioTranscriptionResult } from './jobs.js';

// Re-export schema-derived types
export type {
  AttachmentMetadata,
  GenerateRequest,
  DiscordEnvironment,
  LoadedPersonality,
  MentionedPersona,
  ReferencedChannel,
  RequestContext,
  ReferencedMessage,
  StoredReferencedMessage,
  MessageMetadata,
  LLMGenerationResult,
} from './schemas/index.js';

// Re-export schemas for runtime validation
export {
  attachmentMetadataSchema,
  generateRequestSchema,
  loadedPersonalitySchema,
  requestContextSchema,
  rawAssemblyInputsSchema,
  rawDiscordUserSchema,
  rawMentionedChannelSchema,
  rawMentionedRoleSchema,
  referencedMessageSchema,
} from './schemas/index.js';

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

/**
 * Response from /ai/transcribe endpoint
 *
 * Same envelope shape as GenerateResponse but typed against
 * AudioTranscriptionResult so the `provider` field is reachable on the
 * caller side without unsafe casts.
 */
export interface TranscribeResponse {
  jobId: string;
  requestId: string;
  status: JobStatus;
  result?: AudioTranscriptionResult;
  timestamp?: string;
}
