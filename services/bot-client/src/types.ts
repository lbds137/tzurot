/**
 * Bot Client Types
 *
 * Type definitions for Discord bot client.
 */

import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

// Types for Discord bot client

/**
 * Simple personality configuration
 */
export interface BotPersonality {
  name: string;
  displayName: string;
  avatarUrl?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Attachment metadata (provider-agnostic format)
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
 * Message context for AI generation
 */
export interface MessageContext {
  userId: string;
  userName: string;
  channelId: string;
  serverId?: string;
  messageContent: string;
  conversationHistory?: Array<{
    id?: string; // Internal UUID for deduplication
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: string;
  }>;
  referencedMessage?: {
    author: string;
    content: string;
  };
  // Multimodal support (images, audio, etc)
  attachments?: AttachmentMetadata[];
}

/**
 * Gateway response
 */
export interface GatewayResponse {
  jobId: string;
  requestId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

/**
 * Job result from gateway
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

/**
 * Slash command definition
 */
export interface Command {
  data: SlashCommandBuilder;
  category?: string;
  execute: (interaction: ChatInputCommandInteraction, ...args: unknown[]) => Promise<void>;
}
