/**
 * Shared Test Fixtures for Contract Tests
 *
 * Centralized test data used across api.contract.test.ts and jobs.contract.test.ts
 * to maintain DRY principle and ensure consistency in test data.
 */

import { MessageRole } from '../../constants/message.js';
import type {
  LoadedPersonality,
  RequestContext,
  AttachmentMetadata,
  ReferencedMessage,
} from '../api-types.js';
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
 * Standard image attachment for vision tests
 */
export const IMAGE_ATTACHMENT: AttachmentMetadata = {
  url: 'https://example.com/image.png',
  contentType: 'image/png',
  name: 'image.png',
  size: 2048,
};

/**
 * Standard PDF attachment for document tests
 */
export const PDF_ATTACHMENT: AttachmentMetadata = {
  url: 'https://example.com/document.pdf',
  contentType: 'application/pdf',
  name: 'document.pdf',
  size: 4096,
};

/**
 * Standard Discord response destination
 */
export const DISCORD_DESTINATION: ResponseDestination = {
  type: 'discord',
  channelId: 'channel-123',
};

/**
 * Referenced message for reply context tests
 */
export const REFERENCED_MESSAGE: ReferencedMessage = {
  referenceNumber: 1,
  discordMessageId: 'msg-referenced',
  discordUserId: 'user-456',
  authorUsername: 'OtherUser',
  authorDisplayName: 'Other User',
  content: 'This is a referenced message',
  embeds: '',
  timestamp: new Date('2025-01-01T12:00:00Z').toISOString(),
  locationContext: 'Test Server / #general',
};

/**
 * Conversation history with multiple turns
 */
export const CONVERSATION_HISTORY = [
  {
    role: MessageRole.User,
    content: 'Hello!',
    createdAt: new Date('2025-01-01T10:00:00Z').toISOString(),
  },
  {
    role: MessageRole.Assistant,
    content: 'Hi there! How can I help you?',
    createdAt: new Date('2025-01-01T10:00:05Z').toISOString(),
  },
  {
    role: MessageRole.User,
    content: 'Tell me about yourself',
    createdAt: new Date('2025-01-01T10:01:00Z').toISOString(),
  },
];

/**
 * Standard request IDs for different job types
 */
export const REQUEST_IDS = {
  llmGeneration: 'req-llm-123',
  audioTranscription: 'req-audio-456',
  imageDescription: 'req-image-789',
} as const;
