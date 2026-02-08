/**
 * Tests for chatResponseSender
 *
 * Tests sendCharacterResponse: webhook message sending,
 * message splitting, model footer appending, and guest mode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TextChannel } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';

// Mock serviceRegistry
const mockSendAsPersonality = vi.fn();
vi.mock('../../services/serviceRegistry.js', () => ({
  getWebhookManager: () => ({
    sendAsPersonality: mockSendAsPersonality,
  }),
}));

// Mock redis
const mockStoreWebhookMessage = vi.fn();
vi.mock('../../redis.js', () => ({
  redisService: {
    storeWebhookMessage: (...args: unknown[]) => mockStoreWebhookMessage(...args),
  },
}));

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    splitMessage: (content: string) => [content], // No splitting for simple tests
    DISCORD_LIMITS: { MESSAGE_LENGTH: 2000 },
    AI_ENDPOINTS: { OPENROUTER_MODEL_CARD_URL: 'https://openrouter.ai/models' },
    GUEST_MODE: { FOOTER_MESSAGE: 'Guest mode - limited features' },
    buildModelFooterText: (model: string, url: string) => `[${model}](${url})`,
  };
});

import { sendCharacterResponse } from './chatResponseSender.js';

describe('sendCharacterResponse', () => {
  const mockChannel = {} as TextChannel;
  const mockPersonality = { id: 'personality-1' } as LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendAsPersonality.mockResolvedValue({ id: 'sent-msg-1' });
    mockStoreWebhookMessage.mockResolvedValue(undefined);
  });

  it('should send content via webhook and return message IDs', async () => {
    const result = await sendCharacterResponse(mockChannel, mockPersonality, 'Hello world');

    expect(mockSendAsPersonality).toHaveBeenCalledWith(mockChannel, mockPersonality, 'Hello world');
    expect(result).toEqual(['sent-msg-1']);
  });

  it('should store sent message in Redis for reply routing', async () => {
    await sendCharacterResponse(mockChannel, mockPersonality, 'Hello');

    expect(mockStoreWebhookMessage).toHaveBeenCalledWith('sent-msg-1', 'personality-1');
  });

  it('should append model footer when modelUsed is provided', async () => {
    await sendCharacterResponse(mockChannel, mockPersonality, 'Hello', 'test/model-1');

    const sentContent = mockSendAsPersonality.mock.calls[0][2] as string;
    expect(sentContent).toContain('[test/model-1]');
    expect(sentContent).toContain('openrouter.ai/models');
  });

  it('should append guest mode footer when in guest mode', async () => {
    await sendCharacterResponse(mockChannel, mockPersonality, 'Hello', undefined, true);

    const sentContent = mockSendAsPersonality.mock.calls[0][2] as string;
    expect(sentContent).toContain('Guest mode');
  });

  it('should handle null webhook response gracefully', async () => {
    mockSendAsPersonality.mockResolvedValue(null);

    const result = await sendCharacterResponse(mockChannel, mockPersonality, 'Hello');

    expect(result).toEqual([]);
    expect(mockStoreWebhookMessage).not.toHaveBeenCalled();
  });

  it('should not append footer when modelUsed is empty', async () => {
    await sendCharacterResponse(mockChannel, mockPersonality, 'Hello', '');

    const sentContent = mockSendAsPersonality.mock.calls[0][2] as string;
    expect(sentContent).toBe('Hello');
  });
});
