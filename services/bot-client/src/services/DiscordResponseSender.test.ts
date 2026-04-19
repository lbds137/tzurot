/**
 * DiscordResponseSender Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscordResponseSender } from './DiscordResponseSender.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import type { WebhookManager } from '../utils/WebhookManager.js';

// Mock dependencies
vi.mock('../redis.js', () => ({
  redisService: {
    storeWebhookMessage: vi.fn().mockResolvedValue(undefined),
    getWebhookPersonality: vi.fn(),
    getTTSAudio: vi.fn().mockResolvedValue(null),
    checkHealth: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    splitMessage: vi.fn((content: string) => {
      // Simple mock: split on 2000 char boundaries
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks.length > 0 ? chunks : [content];
    }),
  };
});

describe('DiscordResponseSender', () => {
  let sender: DiscordResponseSender;
  let mockWebhookManager: {
    sendAsPersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    mockWebhookManager = {
      sendAsPersonality: vi.fn().mockResolvedValue({ id: 'msg-123' }),
    };

    mockPersonality = {
      id: 'personality-123',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'testbot',
      systemPrompt: 'You are a test bot',
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1000,
      contextWindowTokens: 4000,
      characterInfo: 'Test bot character',
      personalityTraits: 'Helpful',
    } as LoadedPersonality;

    sender = new DiscordResponseSender(mockWebhookManager as unknown as WebhookManager);
  });

  describe('sendResponse - Webhook Channel', () => {
    it('should send response via webhook in guild channel', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const result = await sender.sendResponse({
        content: 'Hello from bot!',
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        mockPersonality,
        'Hello from bot!',
        undefined
      );
      expect(result.chunkMessageIds).toEqual(['msg-123']);
      expect(result.chunkCount).toBe(1);
    });

    it('should add model indicator when modelUsed is provided', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');

      // Verify exact format: Model: [model-name](<url>) without backticks
      expect(calledContent).toMatch(
        /\n-# Model: \[anthropic\/claude-sonnet-4\.5\]\(<https:\/\/openrouter\.ai\/[^>]+>\)$/
      );
    });

    it('should add guest mode footer when isGuestMode is true', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        isGuestMode: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).toContain('🆓 Using free model (no API key required)');
    });

    it('should add both model indicator and guest mode footer', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'x-ai/grok-4.1-fast:free',
        isGuestMode: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).toContain('Model: [x-ai/grok-4.1-fast:free]');
      expect(calledContent).toContain('🆓 Using free model (no API key required)');
    });

    it('should not add guest mode footer when isGuestMode is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        isGuestMode: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).not.toContain('🆓');
    });

    it('should add auto-response indicator when isAutoResponse is true with model', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
        isAutoResponse: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      // Model line should include auto indicator on same line (compact format)
      expect(calledContent).toContain('Model: [anthropic/claude-sonnet-4.5]');
      expect(calledContent).toContain(' • 📍 auto');
    });

    it('should add standalone auto-response indicator when isAutoResponse is true without model', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        isAutoResponse: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).toContain('📍 auto-response');
    });

    it('should add all three indicators: model, auto-response, and guest mode', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'x-ai/grok-4.1-fast:free',
        isGuestMode: true,
        isAutoResponse: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      // Model and auto on same line
      expect(calledContent).toContain('Model: [x-ai/grok-4.1-fast:free]');
      expect(calledContent).toContain(' • 📍 auto');
      // Guest mode on separate line
      expect(calledContent).toContain('🆓 Using free model (no API key required)');
    });

    it('should add focus mode indicator when focusModeEnabled is true', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        focusModeEnabled: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).toContain('🔒 Focus Mode • LTM retrieval disabled');
    });

    it('should not add focus mode indicator when focusModeEnabled is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        focusModeEnabled: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).not.toContain('🔒');
      expect(calledContent).not.toContain('Focus Mode');
    });

    it('should add all four indicators: model, auto-response, guest mode, and focus mode', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'x-ai/grok-4.1-fast:free',
        isGuestMode: true,
        isAutoResponse: true,
        focusModeEnabled: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      // Model and auto on same line
      expect(calledContent).toContain('Model: [x-ai/grok-4.1-fast:free]');
      expect(calledContent).toContain(' • 📍 auto');
      // Guest mode on separate line
      expect(calledContent).toContain('🆓 Using free model (no API key required)');
      // Focus mode on separate line
      expect(calledContent).toContain('🔒 Focus Mode • LTM retrieval disabled');
    });

    it('should add incognito mode indicator when incognitoModeActive is true', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        incognitoModeActive: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).toContain('👻 Incognito Mode • Memories not being saved');
    });

    it('should not add incognito mode indicator when incognitoModeActive is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        incognitoModeActive: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).not.toContain('👻');
      expect(calledContent).not.toContain('Incognito Mode');
    });

    it('should add all five indicators: model, auto-response, guest mode, focus mode, and incognito', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'x-ai/grok-4.1-fast:free',
        isGuestMode: true,
        isAutoResponse: true,
        focusModeEnabled: true,
        incognitoModeActive: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      // Model and auto on same line
      expect(calledContent).toContain('Model: [x-ai/grok-4.1-fast:free]');
      expect(calledContent).toContain(' • 📍 auto');
      // Guest mode on separate line
      expect(calledContent).toContain('🆓 Using free model (no API key required)');
      // Focus mode on separate line
      expect(calledContent).toContain('🔒 Focus Mode • LTM retrieval disabled');
      // Incognito mode on separate line
      expect(calledContent).toContain('👻 Incognito Mode • Memories not being saved');
    });

    it('should hide model footer when showModelFooter is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
        showModelFooter: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).not.toContain('Model:');
    });

    it('should show standalone auto-response indicator when showModelFooter is false and isAutoResponse is true', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
        isAutoResponse: true,
        showModelFooter: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).not.toContain('Model:');
      expect(calledContent).toContain('📍 auto-response');
    });

    it('should still show other footers when showModelFooter is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        isGuestMode: true,
        focusModeEnabled: true,
        incognitoModeActive: true,
        showModelFooter: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).not.toContain('Model:');
      expect(calledContent).toContain('🆓 Using free model');
      expect(calledContent).toContain('🔒 Focus Mode');
      expect(calledContent).toContain('👻 Incognito Mode');
    });

    it('should not add auto-response indicator when isAutoResponse is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        isAutoResponse: false,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');
      expect(calledContent).toContain('Model: [test-model]');
      expect(calledContent).not.toContain('📍');
    });

    it('should handle chunked messages', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      // Create long content that will be chunked
      const longContent = 'x'.repeat(3000);

      mockWebhookManager.sendAsPersonality
        .mockResolvedValueOnce({ id: 'msg-1' })
        .mockResolvedValueOnce({ id: 'msg-2' });

      const result = await sender.sendResponse({
        content: longContent,
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(2);
      expect(result.chunkMessageIds).toEqual(['msg-1', 'msg-2']);
      expect(result.chunkCount).toBe(2);
    });

    it('should append model indicator to LAST chunk only (preserves newline)', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      // Create content that will be chunked into 2 parts
      const longContent = 'x'.repeat(3000);

      mockWebhookManager.sendAsPersonality
        .mockResolvedValueOnce({ id: 'msg-1' })
        .mockResolvedValueOnce({ id: 'msg-2' });

      await sender.sendResponse({
        content: longContent,
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
      });

      // First chunk should NOT have model indicator
      const firstChunk = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(firstChunk).not.toContain('-# Model:');

      // Last chunk SHOULD have model indicator with newline preserved
      const lastChunk = mockWebhookManager.sendAsPersonality.mock.calls[1][2];
      expect(lastChunk).toMatch(/\n-# Model: \[test-model\]/);
    });
  });

  describe('sendResponse - DM Channel', () => {
    it('should send response via channel.send in DM (no reply indicator)', async () => {
      const mockChannel = createMockTextChannel('dm-123');
      const mockMessage = createMockMessage(mockChannel, null); // DM has no guild
      (mockChannel.send as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'dm-msg-123' });

      const result = await sender.sendResponse({
        content: 'Hello in DM!',
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Test Bot:'),
        })
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Hello in DM!'),
        })
      );
      expect(result.chunkMessageIds).toEqual(['dm-msg-123']);
    });

    it('should add personality prefix before chunking in DMs', async () => {
      const mockChannel = createMockTextChannel('dm-123');
      const mockMessage = createMockMessage(mockChannel, null);
      (mockChannel.send as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: 'dm-msg-1' })
        .mockResolvedValueOnce({ id: 'dm-msg-2' });

      // Long content for chunking
      const longContent = 'x'.repeat(3000);

      const result = await sender.sendResponse({
        content: longContent,
        personality: mockPersonality,
        message: mockMessage,
      });

      // Should have added prefix before chunking
      const firstCallArg = (mockChannel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(firstCallArg.content).toContain('**Test Bot:**');

      expect(result.chunkMessageIds).toEqual(['dm-msg-1', 'dm-msg-2']);
      expect(result.chunkCount).toBe(2);
    });
  });

  describe('sendResponse - Thread Channel', () => {
    it('should send via webhook in thread (guild context)', async () => {
      const mockChannel = createMockThreadChannel('thread-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Thread message',
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        mockPersonality,
        'Thread message',
        undefined
      );
    });
  });

  /**
   * Systematic tests for all 16 realistic indicator combinations.
   *
   * For successful AI responses, modelUsed is always present (set by LLMInvoker).
   * The 4 boolean flags (isAutoResponse, isGuestMode, focusModeEnabled, incognitoModeActive)
   * give 2^4 = 16 combinations.
   *
   * Expected footer format:
   * - Line 1: Model: [name](url) [• 📍 auto] (auto appended to same line if present)
   * - Line 2: 🆓 Using free model... (if guest mode)
   * - Line 3: 🔒 Focus Mode • LTM retrieval disabled (if focus mode)
   * - Line 4: 👻 Incognito Mode • Memories not being saved (if incognito mode)
   */
  describe('sendResponse - Indicator Combinations (systematic)', () => {
    // Define all 16 combinations with expected indicators
    const combinations = [
      // No incognito (8 combinations)
      {
        name: 'model only (no flags)',
        flags: {
          isAutoResponse: false,
          isGuestMode: false,
          focusModeEnabled: false,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: false, guest: false, focus: false, incognito: false },
      },
      {
        name: 'model + auto',
        flags: {
          isAutoResponse: true,
          isGuestMode: false,
          focusModeEnabled: false,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: true, guest: false, focus: false, incognito: false },
      },
      {
        name: 'model + guest',
        flags: {
          isAutoResponse: false,
          isGuestMode: true,
          focusModeEnabled: false,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: false, guest: true, focus: false, incognito: false },
      },
      {
        name: 'model + focus',
        flags: {
          isAutoResponse: false,
          isGuestMode: false,
          focusModeEnabled: true,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: false, guest: false, focus: true, incognito: false },
      },
      {
        name: 'model + auto + guest',
        flags: {
          isAutoResponse: true,
          isGuestMode: true,
          focusModeEnabled: false,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: true, guest: true, focus: false, incognito: false },
      },
      {
        name: 'model + auto + focus',
        flags: {
          isAutoResponse: true,
          isGuestMode: false,
          focusModeEnabled: true,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: true, guest: false, focus: true, incognito: false },
      },
      {
        name: 'model + guest + focus',
        flags: {
          isAutoResponse: false,
          isGuestMode: true,
          focusModeEnabled: true,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: false, guest: true, focus: true, incognito: false },
      },
      {
        name: 'model + auto + guest + focus',
        flags: {
          isAutoResponse: true,
          isGuestMode: true,
          focusModeEnabled: true,
          incognitoModeActive: false,
        },
        expected: { model: true, auto: true, guest: true, focus: true, incognito: false },
      },
      // With incognito (8 combinations)
      {
        name: 'model + incognito',
        flags: {
          isAutoResponse: false,
          isGuestMode: false,
          focusModeEnabled: false,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: false, guest: false, focus: false, incognito: true },
      },
      {
        name: 'model + auto + incognito',
        flags: {
          isAutoResponse: true,
          isGuestMode: false,
          focusModeEnabled: false,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: true, guest: false, focus: false, incognito: true },
      },
      {
        name: 'model + guest + incognito',
        flags: {
          isAutoResponse: false,
          isGuestMode: true,
          focusModeEnabled: false,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: false, guest: true, focus: false, incognito: true },
      },
      {
        name: 'model + focus + incognito (both privacy modes)',
        flags: {
          isAutoResponse: false,
          isGuestMode: false,
          focusModeEnabled: true,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: false, guest: false, focus: true, incognito: true },
      },
      {
        name: 'model + auto + guest + incognito',
        flags: {
          isAutoResponse: true,
          isGuestMode: true,
          focusModeEnabled: false,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: true, guest: true, focus: false, incognito: true },
      },
      {
        name: 'model + auto + focus + incognito',
        flags: {
          isAutoResponse: true,
          isGuestMode: false,
          focusModeEnabled: true,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: true, guest: false, focus: true, incognito: true },
      },
      {
        name: 'model + guest + focus + incognito',
        flags: {
          isAutoResponse: false,
          isGuestMode: true,
          focusModeEnabled: true,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: false, guest: true, focus: true, incognito: true },
      },
      {
        name: 'all five indicators',
        flags: {
          isAutoResponse: true,
          isGuestMode: true,
          focusModeEnabled: true,
          incognitoModeActive: true,
        },
        expected: { model: true, auto: true, guest: true, focus: true, incognito: true },
      },
    ];

    it.each(combinations)(
      'should render correct indicators for: $name',
      async ({ flags, expected }) => {
        const mockChannel = createMockTextChannel('channel-123');
        const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

        await sender.sendResponse({
          content: 'Test response',
          personality: mockPersonality,
          message: mockMessage,
          modelUsed: 'test-model',
          ...flags,
        });

        const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];

        // Always expect content
        expect(calledContent).toContain('Test response');

        // Model indicator (always present in these tests)
        if (expected.model) {
          expect(calledContent).toContain('Model: [test-model]');
        }

        // Auto indicator (on same line as model)
        if (expected.auto) {
          expect(calledContent).toContain(' • 📍 auto');
        } else {
          expect(calledContent).not.toContain('📍');
        }

        // Guest mode indicator
        if (expected.guest) {
          expect(calledContent).toContain('🆓 Using free model');
        } else {
          expect(calledContent).not.toContain('🆓');
        }

        // Focus mode indicator
        if (expected.focus) {
          expect(calledContent).toContain('🔒 Focus Mode');
        } else {
          expect(calledContent).not.toContain('🔒');
        }

        // Incognito mode indicator
        if (expected.incognito) {
          expect(calledContent).toContain('👻 Incognito Mode');
        } else {
          expect(calledContent).not.toContain('👻');
        }
      }
    );

    it('should render indicators in correct order (model+auto, guest, focus, incognito)', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Test',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'test-model',
        isAutoResponse: true,
        isGuestMode: true,
        focusModeEnabled: true,
        incognitoModeActive: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2] as string;

      // Find positions of each indicator
      const modelPos = calledContent.indexOf('Model:');
      const autoPos = calledContent.indexOf('📍 auto');
      const guestPos = calledContent.indexOf('🆓');
      const focusPos = calledContent.indexOf('🔒');
      const incognitoPos = calledContent.indexOf('👻');

      // Verify order: model < auto (same line), then guest, then focus, then incognito
      expect(modelPos).toBeLessThan(autoPos);
      expect(autoPos).toBeLessThan(guestPos);
      expect(guestPos).toBeLessThan(focusPos);
      expect(focusPos).toBeLessThan(incognitoPos);
    });

    it('should keep footer reasonably sized with all indicators', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
        isAutoResponse: true,
        isGuestMode: true,
        focusModeEnabled: true,
        incognitoModeActive: true,
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2] as string;

      // Count footer lines (lines starting with -#)
      const footerLines = calledContent.split('\n').filter(line => line.startsWith('-#'));

      // Should have 4 footer lines max: model+auto, guest, focus, incognito
      expect(footerLines.length).toBeLessThanOrEqual(4);
    });
  });

  describe('sendResponse - Thinking Content', () => {
    it('should send thinking block before main response when showThinking is enabled', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      // Track call order
      const callOrder: string[] = [];
      mockWebhookManager.sendAsPersonality.mockImplementation(
        async (_channel, _personality, content: string) => {
          if (content.includes('💭 **Thinking:**')) {
            callOrder.push('thinking');
          } else {
            callOrder.push('main');
          }
          return { id: `msg-${callOrder.length}` };
        }
      );

      await sender.sendResponse({
        content: 'Main response content',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: 'This is my reasoning process...',
        showThinking: true,
      });

      // Thinking should be sent before main response
      expect(callOrder).toEqual(['thinking', 'main']);
    });

    it('should NOT send thinking block when showThinking is false', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithoutThinking = {
        ...mockPersonality,
        showThinking: false,
      } as LoadedPersonality;

      await sender.sendResponse({
        content: 'Main response content',
        personality: personalityWithoutThinking,
        message: mockMessage,
        thinkingContent: 'This reasoning should NOT be shown',
        showThinking: false,
      });

      // Should only send main response, not thinking
      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(1);
      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).not.toContain('💭 **Thinking:**');
      expect(calledContent).toContain('Main response content');
    });

    it('should NOT send thinking block when thinkingContent is undefined', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      await sender.sendResponse({
        content: 'Main response content',
        personality: personalityWithThinking,
        message: mockMessage,
        showThinking: true,
        // thinkingContent not provided
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(1);
      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).not.toContain('💭 **Thinking:**');
    });

    it('should NOT send thinking block when thinkingContent is empty string', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      await sender.sendResponse({
        content: 'Main response content',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: '',
        showThinking: true,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(1);
      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).not.toContain('💭 **Thinking:**');
    });

    it('should format thinking content with spoiler tags', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      await sender.sendResponse({
        content: 'Main response',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: 'My reasoning here',
        showThinking: true,
      });

      // Find the thinking message call
      const thinkingCall = mockWebhookManager.sendAsPersonality.mock.calls.find(call =>
        (call[2] as string).includes('💭 **Thinking:**')
      );

      expect(thinkingCall).toBeDefined();
      const thinkingContent = thinkingCall![2] as string;

      // Should have header and spoiler format
      expect(thinkingContent).toContain('💭 **Thinking:**');
      expect(thinkingContent).toContain('||My reasoning here||');
    });

    it('should escape existing spoiler markers in thinking content', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      await sender.sendResponse({
        content: 'Main response',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: 'Content with ||existing spoilers|| inside',
        showThinking: true,
      });

      const thinkingCall = mockWebhookManager.sendAsPersonality.mock.calls.find(call =>
        (call[2] as string).includes('💭 **Thinking:**')
      );

      const thinkingContent = thinkingCall![2] as string;
      // Existing spoilers should be escaped
      expect(thinkingContent).toContain('\\|\\|existing spoilers\\|\\|');
    });

    it('should send thinking via DM with personality prefix when not in guild', async () => {
      const mockChannel = createMockTextChannel('dm-123');
      const mockMessage = createMockMessage(mockChannel, null); // No guild = DM
      (mockChannel.send as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'dm-msg-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      await sender.sendResponse({
        content: 'Main response',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: 'DM thinking content',
        showThinking: true,
      });

      // First call should be thinking, second should be main response
      expect(mockChannel.send).toHaveBeenCalledTimes(2);

      const thinkingCall = (mockChannel.send as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(thinkingCall).toContain('**Test Bot:**');
      expect(thinkingCall).toContain('💭 **Thinking:**');
      expect(thinkingCall).toContain('||DM thinking content||');
    });

    it('should continue with main response even if thinking block fails', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      // First call (thinking) fails, second call (main) succeeds
      mockWebhookManager.sendAsPersonality
        .mockRejectedValueOnce(new Error('Webhook failed'))
        .mockResolvedValueOnce({ id: 'msg-main' });

      const result = await sender.sendResponse({
        content: 'Main response',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: 'This thinking will fail',
        showThinking: true,
      });

      // Main response should still be sent
      expect(result.chunkMessageIds).toEqual(['msg-main']);
      expect(result.chunkCount).toBe(1);
    });

    it('should truncate extremely long thinking content', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      // Create very long thinking content (over the 3-message limit)
      const veryLongThinking = 'x'.repeat(10000);

      await sender.sendResponse({
        content: 'Main response',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: veryLongThinking,
        showThinking: true,
      });

      // Find thinking calls (may be multiple chunks)
      const thinkingCalls = mockWebhookManager.sendAsPersonality.mock.calls.filter(call =>
        (call[2] as string).includes('||')
      );

      // Should have at least one thinking call
      expect(thinkingCalls.length).toBeGreaterThan(0);

      // Last chunk should contain truncation indicator if content was truncated
      const allThinkingContent = thinkingCalls.map(c => c[2] as string).join('');
      expect(allThinkingContent).toContain('[...truncated]');
    });

    it('should chunk long thinking content into multiple messages', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const personalityWithThinking = {
        ...mockPersonality,
        showThinking: true,
      } as LoadedPersonality;

      // Create thinking content that needs chunking (but not truncation)
      const longThinking = 'Line of thinking.\n'.repeat(150); // ~2700 chars

      await sender.sendResponse({
        content: 'Main response',
        personality: personalityWithThinking,
        message: mockMessage,
        thinkingContent: longThinking,
        showThinking: true,
      });

      // Should have multiple thinking calls plus the main response
      expect(mockWebhookManager.sendAsPersonality.mock.calls.length).toBeGreaterThan(2);

      // First thinking chunk should have header
      const firstThinkingCall = mockWebhookManager.sendAsPersonality.mock.calls[0][2] as string;
      expect(firstThinkingCall).toContain('💭 **Thinking:**');

      // Subsequent thinking chunks should just have spoiler content
      const secondThinkingCall = mockWebhookManager.sendAsPersonality.mock.calls[1][2] as string;
      expect(secondThinkingCall).toMatch(/^\|\|.*\|\|$/s);
    });
  });

  describe('sendResponse - TTS Audio', () => {
    it('should attach audio file to last webhook chunk when ttsAudioKey present', async () => {
      const { redisService } = await import('../redis.js');
      const audioBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(audioBuffer);

      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Hello from bot!',
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:job-123',
      });

      expect(redisService.getTTSAudio).toHaveBeenCalledWith('tts-audio:job-123');
      // 4th argument is the files array
      const filesArg = mockWebhookManager.sendAsPersonality.mock.calls[0][3];
      expect(filesArg).toEqual([{ attachment: audioBuffer, name: 'voice.wav' }]);
    });

    it('should not attach audio when ttsAudioKey is not present', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Hello!',
        personality: mockPersonality,
        message: mockMessage,
      });

      // 4th argument should be undefined (no files)
      const filesArg = mockWebhookManager.sendAsPersonality.mock.calls[0][3];
      expect(filesArg).toBeUndefined();
    });

    it('should not attach audio when Redis returns null (expired)', async () => {
      const { redisService } = await import('../redis.js');
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(null);

      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Hello!',
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:expired',
      });

      const filesArg = mockWebhookManager.sendAsPersonality.mock.calls[0][3];
      expect(filesArg).toBeUndefined();
    });

    it('should attach over-size notice when audio exceeds Discord file size limit', async () => {
      const { redisService } = await import('../redis.js');
      // Fake a buffer-like object with length > 8 MB to avoid OOM from real allocation
      const oversizedBuffer = { length: 9 * 1024 * 1024 } as unknown as Buffer;
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(oversizedBuffer);

      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Hello!',
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:oversized',
      });

      // User gets a visible signal — a tiny text attachment — instead of a silent drop
      const filesArg = mockWebhookManager.sendAsPersonality.mock.calls[0][3] as
        | { attachment: Buffer; name: string }[]
        | undefined;
      expect(filesArg).toBeDefined();
      expect(filesArg).toHaveLength(1);
      expect(filesArg![0].name).toBe('voice_omitted_too_long.txt');
      // Notice body mentions the actual size so users can infer cause
      const noticeText = filesArg![0].attachment.toString('utf-8');
      expect(noticeText).toContain('9.00 MB');
      expect(noticeText).toContain('Discord limit 8 MB');
    });

    it('should use .ogg extension for audio/ogg content type', async () => {
      const { redisService } = await import('../redis.js');
      const audioBuffer = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // "OggS" magic
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(audioBuffer);

      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Hello!',
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:opus',
        ttsAudioContentType: 'audio/ogg',
      });

      const filesArg = mockWebhookManager.sendAsPersonality.mock.calls[0][3] as
        | { attachment: Buffer; name: string }[]
        | undefined;
      expect(filesArg).toBeDefined();
      expect(filesArg![0].name).toBe('voice.ogg');
    });

    it('should attach audio to last chunk only for multi-chunk responses', async () => {
      const { redisService } = await import('../redis.js');
      const audioBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(audioBuffer);

      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      mockWebhookManager.sendAsPersonality
        .mockResolvedValueOnce({ id: 'msg-1' })
        .mockResolvedValueOnce({ id: 'msg-2' });

      await sender.sendResponse({
        content: 'x'.repeat(3000),
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:job-123',
      });

      // First chunk: no files
      const firstFiles = mockWebhookManager.sendAsPersonality.mock.calls[0][3];
      expect(firstFiles).toBeUndefined();

      // Last chunk: has files
      const lastFiles = mockWebhookManager.sendAsPersonality.mock.calls[1][3];
      expect(lastFiles).toEqual([{ attachment: audioBuffer, name: 'voice.wav' }]);
    });

    it('should use .mp3 extension when ttsAudioContentType is audio/mpeg', async () => {
      const { redisService } = await import('../redis.js');
      const audioBuffer = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(audioBuffer);

      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Hello from ElevenLabs!',
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:job-el',
        ttsAudioContentType: 'audio/mpeg',
      });

      const filesArg = mockWebhookManager.sendAsPersonality.mock.calls[0][3];
      expect(filesArg).toEqual([{ attachment: audioBuffer, name: 'voice.mp3' }]);
    });

    it('should attach audio to DM via object send form', async () => {
      const { redisService } = await import('../redis.js');
      const audioBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
      vi.mocked(redisService.getTTSAudio).mockResolvedValue(audioBuffer);

      const mockChannel = createMockTextChannel('dm-123');
      const mockMessage = createMockMessage(mockChannel, null);
      (mockChannel.send as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'dm-msg-123' });

      await sender.sendResponse({
        content: 'Hello in DM!',
        personality: mockPersonality,
        message: mockMessage,
        ttsAudioKey: 'tts-audio:job-123',
      });

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: expect.stringContaining('Test Bot:'),
        files: [{ attachment: audioBuffer, name: 'voice.wav' }],
      });
    });
  });
});

// Helper functions for creating type-safe mocks
function createMockTextChannel(id: string) {
  const mockChannel = Object.create(TextChannel.prototype);
  mockChannel.id = id;
  mockChannel.send = vi.fn(); // For DM responses (message.channel.send)
  return mockChannel;
}

function createMockThreadChannel(id: string) {
  const mockChannel = Object.create(ThreadChannel.prototype);
  mockChannel.id = id;
  return mockChannel;
}

function createMockMessage(channel: unknown, guild: { id: string } | null): Message<boolean> {
  return {
    channel,
    guild,
    reply: vi.fn(),
  } as unknown as Message<boolean>;
}
