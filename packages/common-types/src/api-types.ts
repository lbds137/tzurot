/**
 * Shared API Types
 *
 * Type definitions shared across services for API requests and responses.
 */

import type { MessageContent } from './ai.js';

/**
 * Attachment metadata for multimodal messages
 * Used by bot-client, api-gateway, and ai-worker
 */
export interface AttachmentMetadata {
  url: string;
  contentType: string; // MIME type (image/jpeg, audio/ogg, etc)
  name?: string;
  size?: number;
  // Voice message specific metadata (Discord.js v14)
  isVoiceMessage?: boolean;
  duration?: number; // seconds
  waveform?: string; // base64 encoded
}

/**
 * API conversation message format
 * Used for conversation history in API requests (flexible, optional fields)
 * Different from ConversationHistoryService's ConversationMessage (strict, database-focused)
 */
export interface ApiConversationMessage {
  id?: string; // Internal UUID for LTM deduplication
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string; // ISO timestamp
}

/**
 * Request body for /ai/generate endpoint
 * Defines the contract between bot-client and api-gateway
 */
export interface GenerateRequest {
  personality: {
    id?: string; // LoadedPersonality UUID from database
    name: string;
    displayName?: string;
    systemPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    memoryEnabled?: boolean;
    memoryScoreThreshold?: number;
    memoryLimit?: number;
    contextWindow?: number;
    avatarUrl?: string;
    // Character fields from LoadedPersonality
    characterInfo?: string;
    personalityTraits?: string;
    personalityTone?: string;
    personalityAge?: string;
    personalityLikes?: string;
    personalityDislikes?: string;
    conversationalGoals?: string;
    conversationalExamples?: string;
  };
  message: MessageContent;
  context: {
    userId: string;
    userName?: string;
    channelId?: string;
    serverId?: string;
    sessionId?: string;
    isProxyMessage?: boolean;
    conversationHistory?: ApiConversationMessage[];
    attachments?: AttachmentMetadata[];
  };
  userApiKey?: string;
}

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
