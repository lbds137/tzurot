import { z } from 'zod';

/**
 * Personality configuration schema
 * Defines how an AI personality behaves and responds
 */
export const PersonalitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(32), // Discord username limit
  avatarUrl: z.string().url().optional(),
  
  // Core AI configuration
  model: z.string().default('anthropic/claude-3.5-sonnet'),
  systemPrompt: z.string().max(4000),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(4096).default(500),
  
  // Behavioral settings
  responseStyle: z.enum(['concise', 'detailed', 'creative', 'technical']).default('concise'),
  formality: z.enum(['casual', 'neutral', 'formal']).default('neutral'),
  
  // Memory and context
  memoryEnabled: z.boolean().default(true),
  contextWindow: z.number().min(1).max(20).default(10), // Number of messages to remember
  
  // Permissions and restrictions
  allowedChannels: z.array(z.string()).optional(), // If not set, works everywhere
  blockedUsers: z.array(z.string()).default([]),
  nsfwAllowed: z.boolean().default(false),
  
  // Rate limiting
  rateLimitPerUser: z.number().min(0).default(10), // Messages per minute
  rateLimitGlobal: z.number().min(0).default(100), // Total messages per minute
  
  // Metadata
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  active: z.boolean().default(true),
  
  // Optional advanced features
  aliases: z.array(z.string()).default([]), // Alternative names to respond to
  customHeaders: z.record(z.string()).optional(), // Provider-specific headers
  functions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.any() // JSON Schema
  })).optional(), // For function calling support
  errorMessage: z.string().optional(), // Custom error message for this personality
});

export type Personality = z.infer<typeof PersonalitySchema>;

/**
 * Simplified personality creation input
 */
export const CreatePersonalitySchema = PersonalitySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  model: true,
  temperature: true,
  maxTokens: true,
  responseStyle: true,
  formality: true,
  memoryEnabled: true,
  contextWindow: true,
  blockedUsers: true,
  nsfwAllowed: true,
  rateLimitPerUser: true,
  rateLimitGlobal: true,
  active: true,
  aliases: true,
});

export type CreatePersonalityInput = z.infer<typeof CreatePersonalitySchema>;

/**
 * Conversation context for a personality
 */
export const ConversationContextSchema = z.object({
  personalityId: z.string().uuid(),
  channelId: z.string(),
  userId: z.string(),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.date(),
    attachments: z.array(z.object({
      type: z.enum(['image', 'audio', 'file']),
      url: z.string().url(),
      mimeType: z.string(),
    })).optional(),
  })),
  metadata: z.record(z.any()).optional(), // For storing additional context
});

export type ConversationContext = z.infer<typeof ConversationContextSchema>;

/**
 * Personality memory entry
 */
export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  personalityId: z.string().uuid(),
  userId: z.string().optional(), // If user-specific
  channelId: z.string().optional(), // If channel-specific
  content: z.string(),
  embedding: z.array(z.number()).optional(), // For vector similarity search
  importance: z.number().min(0).max(1).default(0.5),
  createdAt: z.date(),
  expiresAt: z.date().optional(),
  tags: z.array(z.string()).default([]),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;