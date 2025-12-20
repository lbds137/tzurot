/**
 * Tests for commandHelpers utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    DISCORD_COLORS: {
      SUCCESS: 0x57f287,
      ERROR: 0xed4245,
      WARNING: 0xfee75c,
      BLURPLE: 0x5865f2,
    },
  };
});

vi.mock('./userGatewayClient.js', () => ({
  isGatewayConfigured: vi.fn().mockReturnValue(true),
}));

import {
  replyWithError,
  replyConfigError,
  ensureGatewayConfigured,
  handleCommandError,
  createSuccessEmbed,
  createInfoEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createSafeHandler,
} from './commandHelpers.js';
import { isGatewayConfigured } from './userGatewayClient.js';
import type { ChatInputCommandInteraction } from 'discord.js';

describe('commandHelpers', () => {
  let mockInteraction: ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInteraction = {
      deferReply: vi.fn(),
      editReply: vi.fn(),
      user: { id: 'test-user-id' },
    } as unknown as ChatInputCommandInteraction;
  });

  describe('replyWithError', () => {
    it('should edit reply with error message', async () => {
      await replyWithError(mockInteraction, 'Test error');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Test error',
      });
    });
  });

  describe('replyConfigError', () => {
    it('should edit reply with config error message', async () => {
      await replyConfigError(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Service configuration error. Please try again later.',
      });
    });
  });

  describe('ensureGatewayConfigured', () => {
    it('should return true when gateway is configured', async () => {
      vi.mocked(isGatewayConfigured).mockReturnValue(true);

      const result = await ensureGatewayConfigured(mockInteraction);

      expect(result).toBe(true);
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
    });

    it('should return false and send error when gateway is not configured', async () => {
      vi.mocked(isGatewayConfigured).mockReturnValue(false);

      const result = await ensureGatewayConfigured(mockInteraction);

      expect(result).toBe(false);
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });
  });

  describe('handleCommandError', () => {
    it('should edit reply with generic error message', async () => {
      await handleCommandError(mockInteraction, new Error('Test'), {
        userId: 'test-user',
        command: 'TestCommand',
      });

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });

  describe('embed creators', () => {
    it('createSuccessEmbed should create success colored embed', () => {
      const embed = createSuccessEmbed('Test Title', 'Test Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.title).toBe('Test Title');
      expect(embed.data.description).toBe('Test Description');
      expect(embed.data.color).toBe(0x57f287); // SUCCESS color
    });

    it('createInfoEmbed should create blurple colored embed', () => {
      const embed = createInfoEmbed('Test Title', 'Test Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.title).toBe('Test Title');
      expect(embed.data.color).toBe(0x5865f2); // BLURPLE color
    });

    it('createInfoEmbed should work without description', () => {
      const embed = createInfoEmbed('Test Title');

      expect(embed.data.description).toBeUndefined();
    });

    it('createErrorEmbed should create error colored embed', () => {
      const embed = createErrorEmbed('Error Title', 'Error Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0xed4245); // ERROR color
    });

    it('createWarningEmbed should create warning colored embed', () => {
      const embed = createWarningEmbed('Warning Title', 'Warning Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0xfee75c); // WARNING color
    });
  });

  describe('createSafeHandler', () => {
    it('should call handler normally when no error', async () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined);
      const safeHandler = createSafeHandler(mockHandler, { commandName: 'Test' });

      await safeHandler(mockInteraction);

      expect(mockHandler).toHaveBeenCalledWith(mockInteraction);
    });

    it('should catch errors and use editReply (interaction always deferred at top-level)', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const safeHandler = createSafeHandler(mockHandler, { commandName: 'Test' });

      // Interactions are always deferred at top-level interactionCreate handler
      const deferredInteraction = {
        ...mockInteraction,
        deferred: true,
        replied: false,
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      await safeHandler(deferredInteraction);

      expect(deferredInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
