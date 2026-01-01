/**
 * Tests for Character Settings Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSettings } from './settings.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

describe('Character Settings Subcommand', () => {
  const mockConfig = {} as never;

  const createMockInteraction = (
    action: string,
    character: string
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    return {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'action') return action;
          if (name === 'character') return character;
          return null;
        }),
      },
      user: { id: 'user-456' },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      // Top-level interactionCreate handler already defers
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extended-context-enable action', () => {
    it('should enable extended context successfully', async () => {
      const interaction = createMockInteraction('extended-context-enable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'PUT',
        body: { supportsExtendedContext: true },
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context enabled'),
      });
    });

    it('should handle 401 unauthorized error', async () => {
      const interaction = createMockInteraction('extended-context-enable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'You do not have permission to edit this character.',
      });
    });

    it('should handle 404 not found error', async () => {
      const interaction = createMockInteraction('extended-context-enable', 'nonexistent');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Character "nonexistent" not found.',
      });
    });

    it('should handle other API errors', async () => {
      const interaction = createMockInteraction('extended-context-enable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to update setting: Server error',
      });
    });
  });

  describe('extended-context-disable action', () => {
    it('should disable extended context successfully', async () => {
      const interaction = createMockInteraction('extended-context-disable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'PUT',
        body: { supportsExtendedContext: false },
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context disabled'),
      });
    });

    it('should handle 401 unauthorized error', async () => {
      const interaction = createMockInteraction('extended-context-disable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'You do not have permission to edit this character.',
      });
    });

    it('should handle 404 not found error', async () => {
      const interaction = createMockInteraction('extended-context-disable', 'nonexistent');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Character "nonexistent" not found.',
      });
    });

    it('should handle other API errors', async () => {
      const interaction = createMockInteraction('extended-context-disable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to update setting: Server error',
      });
    });
  });

  describe('show action', () => {
    it('should show character settings with extended context enabled', async () => {
      const interaction = createMockInteraction('show', 'test-char');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personality: {
            id: 'personality-123',
            name: 'Test Character',
            slug: 'test-char',
            supportsExtendedContext: true,
            ownerId: 'user-456',
          },
        },
      });

      await handleSettings(interaction, mockConfig);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'GET',
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(
          /Settings for Test Character[\s\S]*Extended Context: \*\*Enabled\*\*/
        ),
      });
    });

    it('should show character settings with extended context disabled', async () => {
      const interaction = createMockInteraction('show', 'test-char');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personality: {
            id: 'personality-123',
            name: 'Test Character',
            slug: 'test-char',
            supportsExtendedContext: false,
            ownerId: 'user-456',
          },
        },
      });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(
          /Settings for Test Character[\s\S]*Extended Context: \*\*Disabled\*\*/
        ),
      });
    });

    it('should handle 404 not found error', async () => {
      const interaction = createMockInteraction('show', 'nonexistent');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Character "nonexistent" not found.',
      });
    });

    it('should handle other API errors', async () => {
      const interaction = createMockInteraction('show', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to get character: Server error',
      });
    });
  });

  describe('unknown action', () => {
    it('should reply with unknown action message', async () => {
      const interaction = createMockInteraction('invalid-action', 'test-char');

      await handleSettings(interaction, mockConfig);

      // Uses editReply since top-level handler already deferred
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Unknown action: invalid-action',
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors with editReply', async () => {
      const interaction = createMockInteraction('extended-context-enable', 'test-char');
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction, mockConfig);

      // Uses editReply since top-level handler already deferred
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while processing your request.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction('extended-context-enable', 'test-char');
      // Simulate already having replied
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction, mockConfig);

      // Should not call editReply again since already replied
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
