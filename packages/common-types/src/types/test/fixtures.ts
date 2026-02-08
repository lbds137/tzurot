/* eslint-disable sonarjs/no-duplicate-string -- Shared test fixtures with intentional literal repetition for readable contract test data */
/**
 * Shared Test Fixtures for Contract Tests
 *
 * Centralized test data used across api.contract.test.ts and jobs.contract.test.ts
 * to maintain DRY principle and ensure consistency in test data.
 */

import { MessageRole } from '../../constants/message.js';
import type { LoadedPersonality, RequestContext, AttachmentMetadata } from '../api-types.js';
import type { ResponseDestination } from '../jobs.js';

/**
 * Standard test personality used across contract tests
 */
export const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestPersonality',
  displayName: 'Test Personality',
  slug: 'test',
  systemPrompt: 'You are a helpful assistant',
  model: 'anthropic/claude-sonnet-4.5',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
};

/**
 * Minimal context with only required fields
 */
export const MINIMAL_CONTEXT: RequestContext = {
  userId: 'user-123',
};

/**
 * Full context with all optional fields populated
 */
export const FULL_CONTEXT: RequestContext = {
  userId: 'user-123',
  userName: 'TestUser',
  channelId: 'channel-123',
  serverId: 'server-123',
  sessionId: 'session-123',
  activePersonaId: 'persona-123',
  activePersonaName: 'TestPersona',
  conversationHistory: [
    {
      role: MessageRole.User,
      content: 'Previous message',
      createdAt: new Date().toISOString(),
    },
  ],
  attachments: [
    {
      url: 'https://example.com/file.pdf',
      contentType: 'application/pdf',
      name: 'file.pdf',
      size: 1024,
    },
  ],
  environment: {
    type: 'guild' as const,
    guild: {
      id: 'guild-123',
      name: 'Test Guild',
    },
    channel: {
      id: 'channel-123',
      name: 'test-channel',
      type: 'GUILD_TEXT' as const,
    },
  },
  referencedMessages: [
    {
      referenceNumber: 1,
      discordMessageId: 'msg-123',
      discordUserId: 'user-456',
      authorUsername: 'testuser',
      authorDisplayName: 'Test User',
      content: 'Referenced content',
      embeds: '',
      timestamp: new Date().toISOString(),
      locationContext: 'Test Server / #general',
    },
  ],
};

/**
 * Standard audio attachment for transcription tests
 */
export const AUDIO_ATTACHMENT: AttachmentMetadata = {
  url: 'https://example.com/audio.mp3',
  contentType: 'audio/mpeg',
  name: 'audio.mp3',
  size: 1024,
  isVoiceMessage: true,
  duration: 10,
};

/**
 * Standard Discord response destination
 */
export const DISCORD_DESTINATION: ResponseDestination = {
  type: 'discord',
  channelId: 'channel-123',
};

/**
 * Standard request IDs for different job types
 */
export const REQUEST_IDS = {
  llmGeneration: 'req-llm-123',
  audioTranscription: 'req-audio-456',
  imageDescription: 'req-image-789',
} as const;
