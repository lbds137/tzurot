/**
 * Bot Client Types
 *
 * Type definitions for Discord bot client.
 */

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
    metadata?: {
      retrievedMemories?: number;
      tokensUsed?: number;
      processingTimeMs?: number;
    };
  };
}

/**
 * Slash command definition
 */
export interface Command {
  data: {
    name: string;
    description: string;
    toJSON: () => any;
  };
  category?: string;
  execute: (interaction: any, ...args: any[]) => Promise<void>;
}
